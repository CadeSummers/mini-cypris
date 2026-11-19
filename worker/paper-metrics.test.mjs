// Tests for the citation metrics endpoint (paper-metrics.js).
//
// The real Worker runs in Cloudflare's runtime through Miniflare, as in the
// other Worker tests. OpenAlex and NIH iCite are replaced by fakes holding a
// small made-up catalogue, so the tests know exactly what should come back.
//
// Run with: npm run test:worker

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response } from 'miniflare';
import { MAX_DOIS, readDois } from './paper-metrics.js';

const SITE = 'https://mini-cypris.example';
const ENDPOINT = `${SITE}/metrics`;
const FAKE_OPENALEX = 'https://fake-openalex.example';
const FAKE_ICITE = 'https://fake-icite.example';
const TEST_KEY = 'test-openalex-key-not-a-real-secret';

const id = (short) => `https://openalex.org/${short}`;

/** The fake OpenAlex's whole catalogue. */
const WORKS = {
  // In PubMed, in a journal, with two different authors.
  '10.1000/biology': {
    doi: 'https://doi.org/10.1000/biology',
    cited_by_count: 310,
    fwci: 12.23654,
    citation_normalized_percentile: { value: 0.9823 },
    ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/27599104' },
    authorships: [
      { author: { id: id('A1') } },
      { author: { id: id('A9') } },
      { author: { id: id('A2') } },
    ],
    primary_location: { source: { id: id('S1'), type: 'journal' } },
  },
  // Not in PubMed, and held in a repository rather than a journal.
  '10.1000/preprint': {
    doi: 'https://doi.org/10.1000/preprint',
    cited_by_count: 4,
    fwci: null,
    citation_normalized_percentile: null,
    ids: {},
    authorships: [{ author: { id: id('A1') } }],
    primary_location: { source: { id: id('S2'), type: 'repository' } },
  },
};
const AUTHORS = {
  A1: { id: id('A1'), display_name: 'Lead Author', summary_stats: { h_index: 6 } },
  A2: { id: id('A2'), display_name: 'Senior Author', summary_stats: { h_index: 41 } },
  A9: { id: id('A9'), display_name: 'Middle Author', summary_stats: { h_index: 99 } },
};
const SOURCES = {
  S1: {
    id: id('S1'),
    display_name: 'Journal of Examples',
    summary_stats: { h_index: 103 },
    host_organization: id('P1'),
  },
  S2: { id: id('S2'), display_name: 'A Repository', summary_stats: { h_index: 500 } },
};
const PUBLISHERS = {
  P1: { id: id('P1'), display_name: 'Example Press', summary_stats: { h_index: 893 } },
};
const CATALOGUE = { works: WORKS, authors: AUTHORS, sources: SOURCES, publishers: PUBLISHERS };

const EXPECTED = {
  '10.1000/biology': {
    citations: 310,
    fwci: 12.24,
    percentile: 98,
    rcr: 1.97,
    author: { name: 'Senior Author', hIndex: 41 },
    journal: { name: 'Journal of Examples', hIndex: 103 },
    publisher: { name: 'Example Press', hIndex: 893 },
  },
  '10.1000/preprint': {
    citations: 4,
    fwci: null,
    percentile: null,
    rcr: null,
    author: { name: 'Lead Author', hIndex: 6 },
    journal: null,
    publisher: null,
  },
};

/** Every request the Worker sent to OpenAlex or iCite, in order. */
let upstream = [];
/** Lets a test break one upstream: return a Response to answer in its place. */
let sabotage = () => null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function outbound(request) {
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') ?? '';
  const values = filter.slice(filter.indexOf(':') + 1).split('|');
  const call = {
    host: url.origin,
    entity: url.pathname.split('/').filter(Boolean).pop(),
    values,
    key: url.searchParams.get('api_key'),
  };
  if (url.origin === FAKE_ICITE) call.values = (url.searchParams.get('pmids') ?? '').split(',');
  upstream.push(call);

  const broken = sabotage(call);
  if (broken) return broken;

  if (url.origin === FAKE_ICITE) {
    const data = call.values
      .filter((pmid) => pmid === '27599104')
      .map((pmid) => ({ pmid: Number(pmid), relative_citation_ratio: 1.9666071924 }));
    return json({ data });
  }
  if (url.origin === FAKE_OPENALEX) {
    const results = values.map((value) => CATALOGUE[call.entity]?.[value]).filter(Boolean);
    return json({ results });
  }
  return json({ message: 'unexpected host' }, 500);
}

function startWorker(bindings) {
  return new Miniflare({
    workers: [
      {
        modules: true,
        modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
        scriptPath: fileURLToPath(new URL('./core-proxy.js', import.meta.url)),
        compatibilityDate: '2025-01-01',
        bindings: { OPENALEX_ORIGIN: FAKE_OPENALEX, ICITE_ORIGIN: FAKE_ICITE, ...bindings },
        durableObjects: { VISITOR_LIMITER: { className: 'VisitorLimiter', useSQLite: true } },
        serviceBindings: { ASSETS: () => new Response('the Angular app') },
        outboundService: outbound,
      },
    ],
  });
}

let worker;
let visitorCount = 0;
let doiCount = 0;

before(() => {
  worker = startWorker({});
});

after(() => worker.dispose());

beforeEach(() => {
  upstream = [];
  sabotage = () => null;
});

function newVisitor() {
  visitorCount += 1;
  return `192.0.2.${visitorCount}`;
}

/** A DOI no other test has asked about, so the cache never answers for it. */
function newDoi() {
  doiCount += 1;
  return `10.5555/unknown.${doiCount}`;
}

function ask(body, visitor = newVisitor(), on = worker) {
  return on.dispatchFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'cf-connecting-ip': visitor, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const calls = (entity) => upstream.filter((call) => call.entity === entity);

test('accepts DOIs and nothing else', () => {
  assert.deepEqual(readDois({ dois: ['10.1000/ABC', ' 10.1000/abc ', '10.3390/drones7030191'] }), [
    '10.1000/abc',
    '10.3390/drones7030191',
  ]);
  // Things that are not DOIs are dropped; "|" and "," would change the upstream filter.
  assert.deepEqual(
    readDois({ dois: ['not a doi', '10.1/short', '10.1000/a|10.1000/b', '10.1000/a,b', ''] }),
    [],
  );

  for (const body of [null, {}, { dois: [] }, { dois: 'x' }, { dois: [7] }, { dois: [null] }]) {
    assert.equal(readDois(body), null, JSON.stringify(body));
  }
  assert.equal(readDois({ dois: Array(MAX_DOIS + 1).fill('10.1000/abc') }), null);
});

test('returns all five metrics for a paper, and null for one it cannot find', async () => {
  const missing = newDoi();
  const reply = await ask({ dois: ['10.1000/BIOLOGY', '10.1000/preprint', missing] });

  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await reply.json(), { metrics: { ...EXPECTED, [missing]: null } });

  // One request each to works, authors, sources and publishers, and one to iCite.
  assert.deepEqual(upstream.map((call) => call.entity).sort(), [
    'authors',
    'publishers',
    'pubs',
    'sources',
    'works',
  ]);
  // Only the first and last authors are looked up, never the ones in between.
  assert.deepEqual(calls('authors')[0].values.sort(), ['A1', 'A2']);
  // Only journals are looked up; the repository is not treated as one.
  assert.deepEqual(calls('sources')[0].values, ['S1']);
  assert.deepEqual(calls('pubs')[0].values, ['27599104']);
});

test('does not ask iCite when no paper is in PubMed', async () => {
  const worker2 = startWorker({});
  try {
    const reply = await ask({ dois: ['10.1000/preprint'] }, newVisitor(), worker2);
    assert.deepEqual(await reply.json(), {
      metrics: { '10.1000/preprint': EXPECTED['10.1000/preprint'] },
    });
    assert.equal(calls('pubs').length, 0);
    assert.equal(calls('sources').length, 0);
    assert.equal(calls('publishers').length, 0);
  } finally {
    await worker2.dispose();
  }
});

test('remembers each DOI separately, so only new ones are looked up', async () => {
  const worker2 = startWorker({});
  try {
    const visitor = newVisitor();
    const first = await ask({ dois: ['10.1000/biology'] }, visitor, worker2);
    assert.equal(first.headers.get('x-proxy-cache'), 'MISS');
    await first.arrayBuffer();

    let repeat;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      repeat = await ask({ dois: ['10.1000/biology'] }, visitor, worker2);
      if (repeat.headers.get('x-proxy-cache') === 'HIT') break;
      await repeat.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(repeat.headers.get('x-proxy-cache'), 'HIT');
    assert.deepEqual(await repeat.json(), {
      metrics: { '10.1000/biology': EXPECTED['10.1000/biology'] },
    });

    upstream = [];
    const mixed = await ask({ dois: ['10.1000/biology', '10.1000/preprint'] }, visitor, worker2);
    assert.deepEqual(await mixed.json(), { metrics: EXPECTED });
    assert.deepEqual(calls('works')[0].values, ['10.1000/preprint']);
  } finally {
    await worker2.dispose();
  }
});

test('still answers without RCR when iCite is down, and does not remember the gap', async () => {
  const worker2 = startWorker({});
  try {
    const visitor = newVisitor();
    sabotage = (call) => (call.host === FAKE_ICITE ? json({}, 500) : null);
    const partial = await ask({ dois: ['10.1000/biology'] }, visitor, worker2);
    assert.equal(partial.status, 200);
    assert.deepEqual(await partial.json(), {
      metrics: { '10.1000/biology': { ...EXPECTED['10.1000/biology'], rcr: null } },
    });

    sabotage = () => null;
    const complete = await ask({ dois: ['10.1000/biology'] }, visitor, worker2);
    assert.equal(complete.headers.get('x-proxy-cache'), 'MISS');
    assert.deepEqual(await complete.json(), {
      metrics: { '10.1000/biology': EXPECTED['10.1000/biology'] },
    });
  } finally {
    await worker2.dispose();
  }
});

test('still answers without an h-index when that lookup fails', async () => {
  const worker2 = startWorker({});
  try {
    sabotage = (call) => (call.entity === 'authors' ? json({}, 500) : null);
    const reply = await ask({ dois: ['10.1000/biology'] }, newVisitor(), worker2);
    assert.deepEqual(await reply.json(), {
      metrics: { '10.1000/biology': { ...EXPECTED['10.1000/biology'], author: null } },
    });
  } finally {
    await worker2.dispose();
  }
});

test('answers 503 when OpenAlex cannot find the papers, and does not remember the failure', async () => {
  const doi = newDoi();
  sabotage = (call) => (call.entity === 'works' ? json({ error: 'budget used up' }, 429) : null);
  const failed = await ask({ dois: [doi] });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), {
    message: 'Citation metrics are unavailable right now.',
    upstreamStatus: 429,
  });

  sabotage = () => null;
  const retried = await ask({ dois: [doi] });
  assert.equal(retried.status, 200);
  assert.equal(retried.headers.get('x-proxy-cache'), 'MISS');
  await retried.arrayBuffer();
});

test('ignores junk in an upstream answer instead of passing it on', async () => {
  const doi = newDoi();
  sabotage = (call) =>
    call.entity === 'works'
      ? json({
          results: [
            {
              doi: `https://doi.org/${doi}`,
              cited_by_count: '<script>alert(1)</script>',
              fwci: 'high',
              authorships: 'nobody',
              primary_location: null,
              secret: 'should never be returned',
            },
            // A paper nobody asked about is not returned either.
            { doi: 'https://doi.org/10.1000/uninvited', cited_by_count: 5 },
          ],
        })
      : null;

  const reply = await ask({ dois: [doi] });
  assert.deepEqual(await reply.json(), {
    metrics: {
      [doi]: {
        citations: null,
        fwci: null,
        percentile: null,
        rcr: null,
        author: null,
        journal: null,
        publisher: null,
      },
    },
  });
});

test('adds the OpenAlex key when there is one, and never returns it', async () => {
  const keyed = startWorker({ OPENALEX_API_KEY: TEST_KEY });
  try {
    const reply = await ask({ dois: ['10.1000/biology'] }, newVisitor(), keyed);
    const text = await reply.text();
    assert.ok(!text.includes(TEST_KEY));

    const toOpenAlex = upstream.filter((call) => call.host === FAKE_OPENALEX);
    assert.equal(toOpenAlex.length, 4);
    for (const call of toOpenAlex) assert.equal(call.key, TEST_KEY);
    // The key is OpenAlex's; NIH never sees it.
    assert.equal(calls('pubs')[0].key, null);
  } finally {
    await keyed.dispose();
  }

  // Without a key the Worker still works, and sends none.
  upstream = [];
  const reply = await ask({ dois: [newDoi()] });
  assert.equal(reply.status, 200);
  await reply.arrayBuffer();
  assert.equal(calls('works')[0].key, null);
});

test('refuses bad input without calling anyone', async () => {
  const bad = [
    { dois: [] },
    { dois: Array(MAX_DOIS + 1).fill('10.1000/abc') },
    { dois: 'x' },
    {},
    'not json at all',
  ];
  for (const body of bad) {
    const reply = await ask(body);
    assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 40));
    await reply.arrayBuffer();
  }

  // A list with no real DOI in it is answered empty, again without a lookup.
  const none = await ask({ dois: ['not a doi', '10.1000/a|10.1000/b'] });
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { metrics: {} });
  assert.equal(upstream.length, 0);
});

test('serves only POST /metrics', async () => {
  const visitor = newVisitor();
  const get = await worker.dispatchFetch(ENDPOINT, { headers: { 'cf-connecting-ip': visitor } });
  assert.equal(get.status, 404);
  await get.arrayBuffer();

  const other = await worker.dispatchFetch(`${SITE}/metrics/works`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': visitor, 'content-type': 'application/json' },
    body: JSON.stringify({ dois: ['10.1000/biology'] }),
  });
  assert.equal(other.status, 404);
  await other.arrayBuffer();
  assert.equal(upstream.length, 0);
});

test('allows each visitor 10 new lookups a minute; remembered DOIs stay free', async () => {
  const visitor = newVisitor();
  const first = newDoi();
  const reply = await ask({ dois: [first] }, visitor);
  assert.equal(reply.status, 200);
  await reply.arrayBuffer();
  for (let call = 1; call < 10; call += 1) {
    const next = await ask({ dois: [newDoi()] }, visitor);
    assert.equal(next.status, 200);
    await next.arrayBuffer();
  }

  const eleventh = await ask({ dois: [newDoi()] }, visitor);
  assert.equal(eleventh.status, 429);
  assert.equal(eleventh.headers.get('x-proxy-limit'), 'visitor');
  await eleventh.arrayBuffer();
  assert.equal(calls('works').length, 10);

  let cached;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    cached = await ask({ dois: [first] }, visitor);
    if (cached.status === 200) break;
    await cached.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get('x-proxy-cache'), 'HIT');
  await cached.arrayBuffer();
});
