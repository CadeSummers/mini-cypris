// Tests for the Cloudflare Worker (core-proxy.js).
//
// The real Worker runs in Cloudflare's runtime (workerd) through Miniflare, the
// engine inside `wrangler dev`. Its outbound requests are intercepted, so a fake
// CORE answers them: no network, no API key, no rate limit spent.
//
// Run with: npm run test:worker

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response } from 'miniflare';

const TEST_KEY = 'test-key-not-a-real-secret';
const SITE = 'https://mini-cypris.example';
const SEARCH = `${SITE}/core-api/v3/search/works/`;
const AGGREGATE = `${SITE}/core-api/v3/search/works/aggregate`;

/** Every request the Worker sent towards CORE, in order. */
let upstreamCalls = [];
/** What the fake CORE answers; tests replace it. */
let coreReply = okReply;

function okReply() {
  return new Response(JSON.stringify({ totalHits: 1, results: [] }), {
    headers: { 'content-type': 'application/json' },
  });
}

async function fakeCore(request) {
  upstreamCalls.push({
    url: request.url,
    method: request.method,
    authorization: request.headers.get('authorization'),
    body: request.method === 'POST' ? await request.text() : null,
  });
  return coreReply(request);
}

function startWorker(bindings, outboundService = fakeCore) {
  return new Miniflare({
    workers: [
      {
        modules: true,
        scriptPath: fileURLToPath(new URL('./core-proxy.js', import.meta.url)),
        compatibilityDate: '2025-01-01',
        bindings,
        durableObjects: { VISITOR_LIMITER: { className: 'VisitorLimiter', useSQLite: true } },
        // Stands in for the Angular build that Cloudflare serves next to the Worker.
        serviceBindings: { ASSETS: () => new Response('the Angular app') },
        outboundService,
      },
    ],
  });
}

let worker;
let visitorCount = 0;

before(() => {
  worker = startWorker({ CORE_API_KEY: TEST_KEY });
});

after(() => worker.dispose());

beforeEach(() => {
  upstreamCalls = [];
  coreReply = okReply;
});

/** Each test is its own visitor, so one test's requests never count against another's. */
function newVisitor() {
  visitorCount += 1;
  return `203.0.113.${visitorCount}`;
}

function get(url, visitor, headers = {}) {
  return worker.dispatchFetch(url, { headers: { 'cf-connecting-ip': visitor, ...headers } });
}

function post(url, body, visitor) {
  return worker.dispatchFetch(url, {
    method: 'POST',
    headers: { 'cf-connecting-ip': visitor, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The Worker stores an answer after replying, so give the cache a moment to hold it. */
async function untilCached(request) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request();
    if (response.headers.get('x-proxy-cache') === 'HIT') return response;
    await response.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('the answer was never served from the cache');
}

test('adds the API key on the way to CORE and never sends it to the browser', async () => {
  const response = await get(`${SEARCH}?q=key-check&limit=10&offset=0`, newVisitor(), {
    authorization: 'Bearer something-the-browser-sent',
  });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].authorization, `Bearer ${TEST_KEY}`);

  const headerText = JSON.stringify([...response.headers]);
  assert.ok(!text.includes(TEST_KEY), 'key found in the response body');
  assert.ok(!headerText.includes(TEST_KEY), 'key found in the response headers');
});

test('forwards the path and query string to CORE unchanged', async () => {
  await (await get(`${SEARCH}?q=(drone%20AND%20delivery)&limit=25&offset=50`, newVisitor())).text();

  assert.equal(
    upstreamCalls[0].url,
    'https://api.core.ac.uk/v3/search/works/?q=(drone%20AND%20delivery)&limit=25&offset=50',
  );
  assert.equal(upstreamCalls[0].method, 'GET');
});

test('refuses everything except the two endpoints the app uses', async () => {
  const visitor = newVisitor();
  const refused = [
    await get(`${SITE}/core-api/v3/works/123`, visitor),
    await get(`${SITE}/core-api/v3/search/outputs/?q=x`, visitor),
    await get(`${AGGREGATE}?q=x`, visitor),
    await post(`${SEARCH}?q=x`, {}, visitor),
    await worker.dispatchFetch(`${SEARCH}?q=x`, { method: 'DELETE' }),
    await get(`${SITE}/core-api/v3/search/works/../../data-providers/1`, visitor),
  ];

  for (const response of refused) {
    assert.equal(response.status, 404);
    await response.text();
  }
  assert.equal(upstreamCalls.length, 0, 'a refused request still reached CORE');
});

test('serves a repeated search from the cache, whatever the parameter order', async () => {
  const visitor = newVisitor();
  const first = await get(`${SEARCH}?q=cache-check&limit=10&offset=0`, visitor);
  assert.equal(first.headers.get('x-proxy-cache'), 'MISS');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=300');
  const firstBody = await first.text();

  const again = await untilCached(() => get(`${SEARCH}?offset=0&limit=10&q=cache-check`, visitor));

  assert.equal(await again.text(), firstBody);
  assert.equal(upstreamCalls.length, 1, 'CORE was asked again for a cached search');
});

test('caches aggregate requests by their body', async () => {
  const visitor = newVisitor();
  const body = { q: 'aggregate-check', aggregations: ['yearPublished'] };
  const first = await post(AGGREGATE, body, visitor);
  assert.equal(first.headers.get('x-proxy-cache'), 'MISS');
  await first.text();
  assert.equal(upstreamCalls[0].body, JSON.stringify(body));

  await (await untilCached(() => post(AGGREGATE, body, visitor))).text();
  assert.equal(upstreamCalls.length, 1);

  const other = await post(AGGREGATE, { ...body, q: 'a-different-query' }, visitor);
  assert.equal(other.headers.get('x-proxy-cache'), 'MISS');
  await other.text();
  assert.equal(upstreamCalls.length, 2);
});

test("passes CORE's errors through and never caches them", async () => {
  const visitor = newVisitor();
  coreReply = () =>
    new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-retry-after': '2026-11-18T17:17:00+0000',
      },
    });

  const failed = await get(`${SEARCH}?q=error-check`, visitor);
  assert.equal(failed.status, 429);
  assert.equal(failed.headers.get('x-ratelimit-retry-after'), '2026-11-18T17:17:00+0000');
  assert.equal(failed.headers.get('x-proxy-limit'), null, "CORE's limit must not look like ours");
  await failed.text();

  coreReply = okReply;
  const retried = await get(`${SEARCH}?q=error-check`, visitor);
  assert.equal(retried.status, 200);
  assert.equal(retried.headers.get('x-proxy-cache'), 'MISS');
  await retried.text();
  assert.equal(upstreamCalls.length, 2);
});

test('passes back only the response headers on its list', async () => {
  coreReply = () =>
    new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=abc',
        'x-internal-detail': 'core-node-7',
        'x-ratelimit-remaining': '9',
      },
    });

  const response = await get(`${SEARCH}?q=header-check`, newVisitor());
  await response.text();

  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-internal-detail'), null);
  assert.equal(response.headers.get('x-ratelimit-remaining'), '9');
});

test('lets a visitor make 8 new CORE requests a minute and refuses the 9th', async () => {
  const visitor = newVisitor();
  const started = Date.now();

  for (let i = 1; i <= 8; i += 1) {
    const response = await get(`${SEARCH}?q=limit-check-${i}`, visitor);
    assert.equal(response.status, 200, `request ${i} should pass`);
    await response.text();
  }

  const ninth = await get(`${SEARCH}?q=limit-check-9`, visitor);
  await ninth.text();
  assert.equal(ninth.status, 429);
  assert.equal(ninth.headers.get('x-proxy-limit'), 'visitor');
  assert.equal(upstreamCalls.length, 8, 'the refused request must not reach CORE');

  // The visitor may try again when the first of the 8 requests is a minute old.
  const retryAt = new Date(ninth.headers.get('x-ratelimit-retry-after')).getTime();
  assert.ok(retryAt >= started + 60_000 && retryAt <= Date.now() + 60_000, 'unexpected retry time');
  const seconds = Number(ninth.headers.get('retry-after'));
  assert.ok(seconds > 50 && seconds <= 60, `retry-after was ${seconds}`);
});

test('over the limit, cached searches still work and other visitors are unaffected', async () => {
  const visitor = newVisitor();
  for (let i = 1; i <= 8; i += 1) {
    await (await get(`${SEARCH}?q=shared-check-${i}`, visitor)).text();
  }
  assert.equal((await get(`${SEARCH}?q=shared-check-new`, visitor)).status, 429);

  const cached = await untilCached(() => get(`${SEARCH}?q=shared-check-1`, visitor));
  assert.equal(cached.status, 200);
  await cached.text();

  const someoneElse = await get(`${SEARCH}?q=shared-check-new`, newVisitor());
  assert.equal(someoneElse.status, 200);
  await someoneElse.text();
});

test('answers 502 when CORE cannot be reached', async () => {
  // Nothing listens on this port, so the Worker's request to CORE fails to connect.
  const offline = startWorker(
    { CORE_API_KEY: TEST_KEY },
    { external: { address: '127.0.0.1:9', http: {} } },
  );
  try {
    const response = await offline.dispatchFetch(`${SEARCH}?q=outage-check`);
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.message, 'Could not reach the CORE API.');
  } finally {
    await offline.dispose();
  }
});

test('hands everything outside /core-api/ to the Angular app', async () => {
  const response = await get(`${SITE}/some/page`, newVisitor());

  assert.equal(await response.text(), 'the Angular app');
  assert.equal(upstreamCalls.length, 0);
});

test('works without a key, sending no Authorization header', async () => {
  const keyless = startWorker({ CORE_API_KEY: '' });
  try {
    const response = await keyless.dispatchFetch(`${SEARCH}?q=keyless-check`);
    await response.text();

    assert.equal(response.status, 200);
    assert.equal(upstreamCalls.at(-1).authorization, null);
  } finally {
    await keyless.dispose();
  }
});
