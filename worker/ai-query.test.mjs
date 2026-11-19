// Tests for the plain-English endpoint (ai-query.js).
//
// As in core-proxy.test.mjs, the real Worker runs in Cloudflare's runtime
// through Miniflare. The language model is replaced by a fake that the tests
// script, so they can make it misbehave: the point of most of these tests is
// that nothing but a checked CORE query can come out, whatever the model says.
//
// Run with: npm run test:worker

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response } from 'miniflare';
import {
  isSafeCoreQuery,
  keepStatedAuthors,
  MAX_TEXT,
  MODEL,
  modelLimitRetryAt,
} from './ai-query.js';

const SITE = 'https://mini-cypris.example';
const ENDPOINT = `${SITE}/ai/query`;
const FAKE_MODEL = 'https://fake-model.example';

/** Every request the Worker sent to the model, in order. */
let modelCalls = [];
/** What the fake model answers; tests replace it. */
let modelReply = () => answer({ ok: true, queries: ['drone AND delivery'], reason: '' });
let coreCalls = 0;

function answer(response, status = 200) {
  return new Response(JSON.stringify({ response }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function outbound(request) {
  if (request.url.startsWith(FAKE_MODEL)) {
    const call = await request.json();
    modelCalls.push(call);
    return modelReply(call);
  }
  coreCalls += 1;
  return new Response(JSON.stringify({ totalHits: 1, results: [] }), {
    headers: { 'content-type': 'application/json' },
  });
}

function startWorker(bindings) {
  return new Miniflare({
    workers: [
      {
        modules: true,
        modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
        scriptPath: fileURLToPath(new URL('./core-proxy.js', import.meta.url)),
        compatibilityDate: '2025-01-01',
        bindings,
        durableObjects: { VISITOR_LIMITER: { className: 'VisitorLimiter', useSQLite: true } },
        serviceBindings: { ASSETS: () => new Response('the Angular app') },
        outboundService: outbound,
      },
    ],
  });
}

let worker;
let visitorCount = 0;
let textCount = 0;

before(() => {
  worker = startWorker({ AI_ORIGIN: FAKE_MODEL });
});

after(() => worker.dispose());

beforeEach(() => {
  modelCalls = [];
  coreCalls = 0;
  modelReply = () => answer({ ok: true, queries: ['drone AND delivery'], reason: '' });
});

function newVisitor() {
  visitorCount += 1;
  return `198.51.100.${visitorCount}`;
}

/** A question no other test has asked, so the cache never answers for the model. */
function newText() {
  textCount += 1;
  return `papers about topic number ${textCount}`;
}

function ask(body, visitor = newVisitor(), on = worker) {
  return on.dispatchFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'cf-connecting-ip': visitor, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Asks a fresh question while the fake model answers with `response`. */
async function askWhenModelSays(response, mode = 'translate', text = newText()) {
  modelReply = () => answer(response);
  const reply = await ask({ mode, text });
  return { status: reply.status, body: await reply.json() };
}

test('the query check accepts boolean queries over known fields', () => {
  const safe = [
    'drone',
    'abiogenesis AND exoplanet AND yearPublished>2000',
    '(drone OR uav) AND delivery AND NOT military AND yearPublished>=2018',
    '"machine learning" AND documentType:"thesis"',
    'title:"origin of life" OR authors:"Jane Smith"',
    'NOT policy AND "climate change"',
    'café AND naïve',
  ];
  for (const query of safe) assert.equal(isSafeCoreQuery(query), true, query);
});

test('the query check rejects prose, unknown fields and malformed queries', () => {
  const unsafe = [
    '',
    'I cannot help with that request',
    'Sure! Here is a poem about drones',
    'drone delivery',
    'drone AND fullText:delivery',
    'drone AND secret:value',
    'drone AND yearPublished>soon',
    'drone AND (delivery',
    'drone AND "delivery',
    'drone AND',
    'drone; DROP TABLE works',
    'drone AND <script>',
    'drone\nAND delivery',
    'a AND '.repeat(40) + 'a',
    Array.from({ length: 25 }, (_, i) => `t${i}`).join(' OR '),
    42,
  ];
  for (const query of unsafe) assert.equal(isSafeCoreQuery(query), false, String(query));
});

test('turns a plain-English request into a query', async () => {
  modelReply = () =>
    answer({ ok: true, queries: ['abiogenesis AND exoplanet AND yearPublished>2000'], reason: '' });
  const text = 'find me work on the origin of life and distant planets since the year 2000';

  const reply = await ask({ mode: 'translate', text });

  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await reply.json(), {
    ok: true,
    queries: ['abiogenesis AND exoplanet AND yearPublished>2000'],
  });

  assert.equal(modelCalls.length, 1);
  const [call] = modelCalls;
  assert.equal(call.model, MODEL);
  assert.equal(call.temperature, 0);
  assert.equal(call.response_format.type, 'json_schema');
  // The visitor's words travel as data in their own message, apart from the rules.
  assert.deepEqual(call.messages.at(-1), { role: 'user', content: text });
  assert.equal(call.messages[0].role, 'system');
  assert.ok(!call.messages[0].content.includes(text));
});

test("passes on the model's refusal as a code, never as its own words", async () => {
  const refused = await askWhenModelSays({
    ok: false,
    queries: [],
    reason: 'not_a_search',
    message: 'As an AI model I would rather talk about something else.',
  });
  assert.deepEqual(refused, { status: 200, body: { ok: false, reason: 'not_a_search' } });

  const unknownReason = await askWhenModelSays({
    ok: false,
    queries: [],
    reason: 'Here is a poem',
  });
  assert.deepEqual(unknownReason.body, { ok: false, reason: 'unclear' });
});

test('drops anything from the model that is not a safe query', async () => {
  const replies = [
    { ok: true, queries: ['Sure! Here is a poem about drones.'], reason: '' },
    { ok: true, queries: ['I cannot help with that request'], reason: '' },
    { ok: true, queries: ['drone AND fullText:delivery'], reason: '' },
    { ok: true, queries: ['x'.repeat(MAX_TEXT + 1)], reason: '' },
    { ok: true, queries: [{ nested: 'drone' }, 7, null], reason: '' },
    { ok: true, queries: 'drone', reason: '' },
    { ok: true, reason: '' },
    'this is not JSON',
    null,
    ['drone'],
  ];
  for (const response of replies) {
    const { status, body } = await askWhenModelSays(response);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: false, reason: 'unclear' }, JSON.stringify(response));
  }
});

test('keeps the safe queries when the model mixes good and bad', async () => {
  const mixed = await askWhenModelSays(
    {
      ok: true,
      queries: ['ignore this sentence please', 'drone AND delivery', 'uav AND parcel'],
      reason: '',
    },
    'translate',
  );
  // Translating returns one query: the first that passed.
  assert.deepEqual(mixed.body, { ok: true, queries: ['drone AND delivery'] });

  // A reply sent as a JSON string is read the same way.
  const asText = await askWhenModelSays(
    JSON.stringify({ ok: true, queries: ['uav AND parcel'], reason: '' }),
  );
  assert.deepEqual(asText.body, { ok: true, queries: ['uav AND parcel'] });
});

test('related searches: up to three, no repeats, and never the query that was sent', async () => {
  const { body } = await askWhenModelSays(
    {
      ok: true,
      queries: [
        'Drone AND Delivery',
        'uav AND parcel',
        'UAV and PARCEL'.replace('and', 'AND'),
        'drone AND logistics',
        '"last mile" AND drone',
        'drone AND regulation',
      ],
      reason: '',
    },
    'related',
    'drone AND delivery',
  );
  assert.deepEqual(body, {
    ok: true,
    queries: ['uav AND parcel', 'drone AND logistics', '"last mile" AND drone'],
  });
});

test('a spelling correction that changes nothing is not a correction', async () => {
  const { body } = await askWhenModelSays(
    { ok: true, queries: ['abiogenesis AND exoplanet'], reason: '' },
    'correct',
    'Abiogenesis AND Exoplanet',
  );
  assert.deepEqual(body, { ok: false, reason: 'unclear' });
});

test('a spelling correction must keep every term of the query', async () => {
  const input = '"mashine learning" AND protien AND yearPublished>2019';

  const dropped = await askWhenModelSays(
    { ok: true, queries: ['protein AND yearPublished>2019'], reason: '' },
    'correct',
    input,
  );
  assert.deepEqual(dropped.body, { ok: false, reason: 'unclear' });

  const added = await askWhenModelSays(
    { ok: true, queries: [`${input.replace('protien', 'protein')} AND enzyme`], reason: '' },
    'correct',
    input,
  );
  assert.deepEqual(added.body, { ok: false, reason: 'unclear' });
});

test('quotes the model puts around single words are removed', async () => {
  const { body } = await askWhenModelSays(
    { ok: true, queries: ['"machine learning" AND "protein" AND yearPublished>2019'], reason: '' },
    'correct',
    '"mashine learning" AND protien AND yearPublished>2019 ',
  );
  assert.deepEqual(body, {
    ok: true,
    queries: ['"machine learning" AND protein AND yearPublished>2019'],
  });
});

test('refuses bad input without calling the model', async () => {
  const bad = [
    { mode: 'translate', text: 'x'.repeat(MAX_TEXT + 1) },
    { mode: 'translate', text: '   ' },
    { mode: 'translate' },
    { mode: 'chat', text: 'hello' },
    { mode: 'constructor', text: 'hello' },
    { text: 'drones' },
    'not json at all',
  ];
  for (const body of bad) {
    const reply = await ask(body);
    assert.equal(reply.status, 400, JSON.stringify(body));
    await reply.arrayBuffer();
  }
  assert.equal(modelCalls.length, 0);
});

test('serves only POST /ai/query', async () => {
  const visitor = newVisitor();
  const get = await worker.dispatchFetch(ENDPOINT, { headers: { 'cf-connecting-ip': visitor } });
  assert.equal(get.status, 404);
  await get.arrayBuffer();

  const other = await worker.dispatchFetch(`${SITE}/ai/chat`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': visitor, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'translate', text: 'drones' }),
  });
  assert.equal(other.status, 404);
  await other.arrayBuffer();
  assert.equal(modelCalls.length, 0);
});

test('answers a repeated question from the cache, ignoring case and spacing', async () => {
  const visitor = newVisitor();
  const first = await ask({ mode: 'translate', text: 'Papers about   Cached Drones' }, visitor);
  assert.equal(first.headers.get('x-proxy-cache'), 'MISS');
  await first.arrayBuffer();

  let repeat;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    repeat = await ask({ mode: 'translate', text: 'papers about cached drones' }, visitor);
    if (repeat.headers.get('x-proxy-cache') === 'HIT') break;
    await repeat.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(repeat.headers.get('x-proxy-cache'), 'HIT');
  assert.deepEqual(await repeat.json(), { ok: true, queries: ['drone AND delivery'] });
  assert.equal(modelCalls.length, 1);

  // The same words in another mode are a different question.
  const related = await ask({ mode: 'related', text: 'papers about cached drones' }, visitor);
  assert.equal(related.headers.get('x-proxy-cache'), 'MISS');
  await related.arrayBuffer();
});

test('allows each visitor 15 model calls a minute, separately from CORE searches', async () => {
  const visitor = newVisitor();
  for (let call = 0; call < 15; call += 1) {
    const reply = await ask({ mode: 'translate', text: newText() }, visitor);
    assert.equal(reply.status, 200);
    await reply.arrayBuffer();
  }

  const next = await ask({ mode: 'translate', text: newText() }, visitor);
  assert.equal(next.status, 429);
  assert.equal(next.headers.get('x-proxy-limit'), 'visitor');
  assert.ok(Number(next.headers.get('retry-after')) > 0);
  await next.arrayBuffer();
  assert.equal(modelCalls.length, 15);

  // The same visitor can still search CORE, and another visitor can still ask.
  const search = await worker.dispatchFetch(`${SITE}/core-api/v3/search/works/?q=limit-check`, {
    headers: { 'cf-connecting-ip': visitor },
  });
  assert.equal(search.status, 200);
  await search.arrayBuffer();
  assert.equal(coreCalls, 1);

  const someoneElse = await ask({ mode: 'translate', text: newText() });
  assert.equal(someoneElse.status, 200);
  await someoneElse.arrayBuffer();
});

test('answers 503 when the model fails, and does not remember the failure', async () => {
  const text = newText();
  modelReply = () => answer(null, 500);
  const failed = await ask({ mode: 'translate', text });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), {
    message: 'Plain-English search is unavailable right now.',
  });

  modelReply = () => answer({ ok: true, queries: ['drone AND delivery'], reason: '' });
  const retried = await ask({ mode: 'translate', text });
  assert.equal(retried.status, 200);
  assert.equal(retried.headers.get('x-proxy-cache'), 'MISS');
  await retried.arrayBuffer();
});

test('a model that is taking no more calls answers 429 with the time to come back', async () => {
  const text = newText();
  modelReply = () => answer(null, 429);
  const before = Date.now();
  const busy = await ask({ mode: 'related', text });
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('x-proxy-limit'), 'model');
  const retryAt = new Date(busy.headers.get('x-ratelimit-retry-after')).getTime();
  assert.ok(retryAt >= before + 59_000 && retryAt <= Date.now() + 61_000);
  await busy.arrayBuffer();

  // Nothing was remembered: the next call reaches the model again.
  modelReply = () => answer({ ok: true, queries: ['drone AND delivery'], reason: '' });
  const retried = await ask({ mode: 'related', text });
  assert.equal(retried.status, 200);
  await retried.arrayBuffer();
});

test('a query written for CORE with authors/name is accepted, and shown back as authors', async () => {
  assert.equal(isSafeCoreQuery('drone AND authors/name:"Alkouz, Balsam"'), true);
  assert.equal(isSafeCoreQuery('drone AND authors/email:x'), false);
  assert.equal(isSafeCoreQuery('drone AND publisher/name:x'), false);

  modelReply = () =>
    answer({
      ok: true,
      queries: ['uav AND authors/name:"Alkouz, Balsam"', 'drone AND authors:Alkouz'],
      reason: '',
    });
  const reply = await ask({ mode: 'related', text: 'drone AND authors/name:"Alkouz, Balsam"' });
  assert.deepEqual(await reply.json(), {
    ok: true,
    queries: ['uav AND authors:"Alkouz, Balsam"', 'drone AND authors:Alkouz'],
  });
});

test('the prompt tells the model the document types CORE uses and how to write names', async () => {
  const reply = await ask({ mode: 'translate', text: newText() });
  await reply.arrayBuffer();
  const system = modelCalls.at(-1).messages[0].content;
  assert.match(system, /"journal article", "conference paper"/);
  assert.match(system, /authors:"Smith, Jane" OR authors:"Jane Smith"/);
  assert.match(system, /publisher:Elsevier/);
  assert.doesNotMatch(system, /DOCUMENT_TYPES|CURRENT_YEAR/);
});

test('an author filter keeps only the name words the request contains', () => {
  const by = 'journal articles about coral reefs by Hughes after 2015';
  // A given name the model made up is removed, and the repeat it leaves is said once.
  assert.equal(
    keepStatedAuthors('"coral reef" AND (authors:"Hughes, Terry" OR authors:"Terry Hughes")', by),
    '"coral reef" AND authors:Hughes',
  );
  // So is an empty given name, and quotes around what is now one word.
  assert.equal(
    keepStatedAuthors('reef AND (authors:"Hughes, " OR authors:Hughes) AND publisher:Springer', by),
    'reef AND authors:Hughes AND publisher:Springer',
  );
  assert.equal(
    keepStatedAuthors('reef AND (authors:Hughes OR authors:"Hughes, " OR authors:"Hughes")', by),
    'reef AND authors:Hughes',
  );

  // A full name the user gave is kept, in both orders, whatever its case.
  const full = 'drone delivery papers written by balsam alkouz';
  const both = '(drone OR uav) AND (authors:"Alkouz, Balsam" OR authors:"Balsam Alkouz")';
  assert.equal(keepStatedAuthors(both, full), both);

  // Nothing but author values is touched.
  const other = 'title:"Terry Hughes" AND NOT (reef OR atoll) AND yearPublished>=2015';
  assert.equal(keepStatedAuthors(other, by), other);
  // An author with no word from the request cannot be cut down, so it is left.
  assert.equal(keepStatedAuthors('reef AND authors:Smith', by), 'reef AND authors:Smith');
});

test('a made-up given name never reaches the page', async () => {
  modelReply = () =>
    answer({
      ok: true,
      queries: ['"coral reef" AND (authors:"Hughes, Terry" OR authors:"Terry Hughes")'],
      reason: '',
    });
  const reply = await ask({ mode: 'translate', text: `coral reef papers by Hughes ${newText()}` });
  assert.deepEqual(await reply.json(), {
    ok: true,
    queries: ['"coral reef" AND authors:Hughes'],
  });
});

test("tells Cloudflare's two volume errors apart from other failures", () => {
  const now = Date.UTC(2026, 10, 19, 18, 30);

  // The daily allowance comes back at the next midnight, UTC.
  assert.equal(
    modelLimitRetryAt(
      new Error('3036: You have used up your daily free allocation of 10,000 neurons'),
      now,
    ),
    Date.UTC(2026, 10, 20),
  );
  assert.equal(
    modelLimitRetryAt(new Error('3040: Capacity temporarily exceeded, please try again.'), now),
    now + 60_000,
  );
  assert.equal(modelLimitRetryAt(new Error('5007: No such model'), now), null);
  assert.equal(modelLimitRetryAt(new Error('no model is configured'), now), null);
});

test('answers 503 when no model is configured', async () => {
  const bare = startWorker({});
  try {
    const reply = await ask({ mode: 'translate', text: 'drones' }, newVisitor(), bare);
    assert.equal(reply.status, 503);
    await reply.arrayBuffer();
  } finally {
    await bare.dispose();
  }
});
