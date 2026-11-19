// Citation metrics for the papers on screen.
//
// CORE has no usable citation data (its citationCount is 0 for every paper
// sampled), so the numbers come from two free, open sources:
//
//   - OpenAlex: citation count, field-weighted citation impact (FWCI), and the
//     h-index of a paper's authors, journal and publisher;
//   - NIH iCite: the Relative Citation Ratio (RCR), for papers in PubMed.
//
// Papers are matched by DOI only. The app sends the DOIs of the papers it is
// showing; nothing about the visitor or their query goes to either service.
//
// This is not an open proxy: the only input is a list of DOIs, each checked,
// and the only output is the handful of numbers below.

const OPENALEX = 'https://api.openalex.org';
const ICITE = 'https://icite.od.nih.gov';

/** The most DOIs one request may ask about: one full page of papers. */
export const MAX_DOIS = 100;

/** New lookups each visitor may cause per minute; cached DOIs are free. */
export const METRICS_VISITOR_LIMIT = 10;

/** Citation counts move slowly, so a day-old answer is fine. */
const CACHE_SECONDS = 86_400;

/** How many ids go into one OpenAlex filter (its limit is 100). */
const CHUNK = 50;

/**
 * A DOI, lower-cased. "|" and "," are refused because they are OR and AND in
 * an OpenAlex filter; a DOI containing one simply gets no metrics.
 */
const DOI = /^10\.\d{4,9}\/[^\s|,"<>\\]{1,200}$/;

function reply(status, body, cacheStatus) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (cacheStatus) headers['x-proxy-cache'] = cacheStatus;
  return new Response(JSON.stringify(body), { status, headers });
}

/** The valid, distinct DOIs in a request body, or null if the body is not acceptable. */
export function readDois(body) {
  if (!Array.isArray(body?.dois) || !body.dois.length || body.dois.length > MAX_DOIS) return null;
  const dois = new Set();
  for (const value of body.dois) {
    if (typeof value !== 'string') return null;
    const doi = value.trim().toLowerCase();
    if (DOI.test(doi)) dois.add(doi);
  }
  return [...dois];
}

function chunks(items, size = CHUNK) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "https://openalex.org/A123" -> "A123"; null for anything else. */
function shortId(url, letter) {
  const id = typeof url === 'string' ? url.split('/').pop() : '';
  return id && new RegExp(`^${letter}\\d+$`).test(id) ? id : null;
}

function number(value, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function named(entity) {
  const hIndex = number(entity?.summary_stats?.h_index);
  const name = typeof entity?.display_name === 'string' ? entity.display_name : null;
  return hIndex === null || !name ? null : { name, hIndex };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return response.json();
}

/** Every result of one OpenAlex list endpoint for a set of ids, by batches. */
async function openAlexList(env, entity, filterField, ids, select) {
  const origin = (env.OPENALEX_ORIGIN ?? '').trim() || OPENALEX;
  const key = (env.OPENALEX_API_KEY ?? '').trim();
  const pages = await Promise.all(
    chunks(ids).map((batch) => {
      const params = new URLSearchParams({
        filter: `${filterField}:${batch.join('|')}`,
        select,
        'per-page': String(CHUNK),
      });
      if (key) params.set('api_key', key);
      return getJson(`${origin}/${entity}?${params}`);
    }),
  );
  return pages.flatMap((page) => (Array.isArray(page?.results) ? page.results : []));
}

/** Like openAlexList, but an h-index we cannot fetch is left out, not fatal. */
async function byId(env, entity, ids, select, letter, problems) {
  const found = new Map();
  if (!ids.length) return found;
  try {
    for (const item of await openAlexList(env, entity, 'ids.openalex', ids, select)) {
      const id = shortId(item?.id, letter);
      if (id) found.set(id, item);
    }
  } catch {
    problems.incomplete = true;
  }
  return found;
}

/** RCR by PubMed id, from NIH iCite. */
async function relativeCitationRatios(env, pmids, problems) {
  const ratios = new Map();
  if (!pmids.length) return ratios;
  const origin = (env.ICITE_ORIGIN ?? '').trim() || ICITE;
  try {
    const pages = await Promise.all(
      chunks(pmids, 100).map((batch) =>
        getJson(`${origin}/api/pubs?pmids=${batch.join(',')}&fl=pmid,relative_citation_ratio`),
      ),
    );
    for (const row of pages.flatMap((page) => (Array.isArray(page?.data) ? page.data : []))) {
      ratios.set(String(row?.pmid), number(row?.relative_citation_ratio, 2));
    }
  } catch {
    problems.incomplete = true;
  }
  return ratios;
}

/**
 * Looks up the given DOIs. Returns a metrics object, or null, for each one,
 * and whether every part of the answer could be fetched. Throws only if the
 * first step, finding the papers in OpenAlex, fails.
 */
export async function lookUp(env, dois) {
  const problems = { incomplete: false };
  const works = await openAlexList(
    env,
    'works',
    'doi',
    dois,
    'doi,cited_by_count,fwci,citation_normalized_percentile,ids,authorships,primary_location',
  );

  // For each paper: the first and last author (the lead and, by convention in
  // many fields, the senior author), its journal, and its PubMed id if any.
  const found = new Map();
  for (const work of works) {
    const doi = String(work?.doi ?? '')
      .replace(/^https?:\/\/doi\.org\//i, '')
      .toLowerCase();
    if (!dois.includes(doi) || found.has(doi)) continue;

    const authorships = Array.isArray(work.authorships) ? work.authorships : [];
    const authors = [authorships[0], authorships.at(-1)]
      .map((authorship) => shortId(authorship?.author?.id, 'A'))
      .filter(Boolean);
    const source = work.primary_location?.source;
    const pmid = /(\d+)\/?$/.exec(String(work.ids?.pmid ?? ''))?.[1] ?? null;
    found.set(doi, {
      work,
      authors: [...new Set(authors)],
      source: source?.type === 'journal' ? shortId(source.id, 'S') : null,
      pmid,
    });
  }

  const all = [...found.values()];
  const distinct = (values) => [...new Set(values.filter(Boolean))];
  const stats = 'id,display_name,summary_stats';

  const [authors, sources, ratios] = await Promise.all([
    byId(env, 'authors', distinct(all.flatMap((paper) => paper.authors)), stats, 'A', problems),
    byId(
      env,
      'sources',
      distinct(all.map((paper) => paper.source)),
      `${stats},host_organization`,
      'S',
      problems,
    ),
    relativeCitationRatios(env, distinct(all.map((paper) => paper.pmid)), problems),
  ]);
  const publisherOf = (sourceId) => shortId(sources.get(sourceId)?.host_organization, 'P');
  const publishers = await byId(
    env,
    'publishers',
    distinct([...sources.keys()].map(publisherOf)),
    stats,
    'P',
    problems,
  );

  const metrics = {};
  for (const doi of dois) {
    const paper = found.get(doi);
    if (!paper) {
      metrics[doi] = null;
      continue;
    }
    // Of the first and last author, report the one with the higher h-index.
    const author = paper.authors
      .map((id) => named(authors.get(id)))
      .filter(Boolean)
      .sort((a, b) => b.hIndex - a.hIndex)[0];
    const percentile = number(paper.work.citation_normalized_percentile?.value, 3);

    metrics[doi] = {
      citations: number(paper.work.cited_by_count),
      fwci: number(paper.work.fwci, 2),
      percentile: percentile === null ? null : Math.round(percentile * 100),
      rcr: paper.pmid ? (ratios.get(paper.pmid) ?? null) : null,
      author: author ?? null,
      journal: named(sources.get(paper.source)),
      publisher: named(publishers.get(publisherOf(paper.source))),
    };
  }
  return { metrics, complete: !problems.incomplete };
}

/**
 * POST /metrics with { dois }. Answers { metrics: { [doi]: {...} | null } }.
 * `shared` carries the helpers this endpoint has in common with the CORE proxy.
 */
export async function handlePaperMetrics(request, url, env, ctx, shared) {
  if (request.method !== 'POST' || url.pathname !== '/metrics') {
    return reply(404, { message: 'This endpoint only looks up citation metrics by DOI.' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const dois = readDois(body);
  if (!dois) return reply(400, { message: `Send between 1 and ${MAX_DOIS} DOIs.` });

  // Each DOI is remembered separately, so a later page of papers, or another
  // visitor's search, only looks up the DOIs nobody has asked about today.
  const cache = caches.default;
  const keyFor = (doi) =>
    new Request(`${url.origin}/metrics/cache/${encodeURIComponent(doi)}`, { method: 'GET' });
  const metrics = {};
  const missing = [];
  await Promise.all(
    dois.map(async (doi) => {
      const cached = await cache.match(keyFor(doi));
      if (cached) metrics[doi] = (await cached.json()).metrics;
      else missing.push(doi);
    }),
  );
  if (!missing.length) return reply(200, { metrics }, 'HIT');

  const slot = await shared.takeVisitorSlot(request, env, 'metrics:', METRICS_VISITOR_LIMIT);
  if (!slot.allowed) return shared.visitorLimitResponse(slot.retryAt);

  let looked;
  try {
    looked = await lookUp(env, missing);
  } catch {
    // Includes OpenAlex's daily allowance running out. The papers still show.
    return reply(503, { message: 'Citation metrics are unavailable right now.' });
  }

  for (const doi of missing) {
    metrics[doi] = looked.metrics[doi];
    // A partial answer (say, iCite was down) is not remembered, so it can be completed later.
    if (!looked.complete) continue;
    const toStore = new Response(JSON.stringify({ metrics: looked.metrics[doi] }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(keyFor(doi), toStore));
  }
  return reply(200, { metrics }, 'MISS');
}
