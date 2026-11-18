// Production counterpart of proxy.conf.mjs, run as a Cloudflare Worker.
//
// The deployed app calls /core-api/... exactly as it does in development. This
// Worker forwards the two CORE endpoints the app uses and attaches the API key
// from an encrypted Worker secret, so the key never reaches the browser.
//
// It is deliberately not an open proxy: anything other than the search and
// aggregate endpoints is refused, so the key cannot be used for other calls.

const CORE_ORIGIN = 'https://api.core.ac.uk';

/** The only CORE endpoints the app needs, by method. */
const ALLOWED = {
  GET: ['/v3/search/works/'],
  POST: ['/v3/search/works/aggregate'],
};

/** Response headers worth passing back; the app reads the rate-limit ones. */
const PASS_THROUGH = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-retry-after',
  'retry-after',
];

/** How long the browser may reuse a search without asking again. */
const BROWSER_CACHE_SECONDS = 300;

/**
 * How long the Worker itself remembers a successful CORE answer. Every visitor
 * shares one key and its small rate limit, so a repeated query (the example
 * queries, a shared link) should not spend a request. Year counts change far
 * more slowly than result lists, hence the longer time for aggregates.
 */
const EDGE_CACHE_SECONDS = { GET: 600, POST: 3600 };

/** Says whether the answer came from the Worker's cache; handy when debugging. */
const CACHE_HEADER = 'x-proxy-cache';

function json(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The Cache API only stores GET requests, so every lookup uses a synthetic GET
 * URL. For the aggregate POST, a hash of the body stands in for the query.
 */
async function cacheKeyFor(method, url, body) {
  const key = new URL(url);
  key.searchParams.sort();
  if (method === 'POST') key.search = `?body=${await sha256Hex(body)}`;
  return new Request(key.toString(), { method: 'GET' });
}

/** What the browser receives: cached or fresh, the headers look the same. */
function forClient(response, method, cacheStatus) {
  const headers = new Headers(response.headers);
  headers.set(CACHE_HEADER, cacheStatus);
  if (method === 'GET') {
    headers.set('cache-control', `public, max-age=${BROWSER_CACHE_SECONDS}`);
  } else {
    headers.delete('cache-control');
  }
  return new Response(response.body, { status: response.status, headers });
}

async function proxyToCore(request, url, apiKey, ctx) {
  const method = request.method;
  const path = url.pathname.replace(/^\/core-api/, '');
  if (!ALLOWED[method]?.includes(path)) {
    return json(404, 'This proxy only serves CORE work search and aggregation.');
  }

  const body = method === 'POST' ? await request.text() : undefined;
  const cache = caches.default;
  const cacheKey = await cacheKeyFor(method, url, body);
  const cached = await cache.match(cacheKey);
  if (cached) return forClient(cached, method, 'HIT');

  const headers = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let upstream;
  try {
    upstream = await fetch(`${CORE_ORIGIN}${path}${url.search}`, { method, headers, body });
  } catch {
    return json(502, 'Could not reach the CORE API.');
  }

  const responseHeaders = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  // Errors (including rate limits) are passed on as they are and never cached.
  if (!upstream.ok) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  const payload = await upstream.text();
  const toStore = new Response(payload, {
    status: 200,
    headers: {
      'content-type': responseHeaders.get('content-type') ?? 'application/json',
      // Read by the Cache API to decide how long to keep the entry.
      'cache-control': `public, max-age=${EDGE_CACHE_SECONDS[method]}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, toStore));

  return forClient(
    new Response(payload, { status: 200, headers: responseHeaders }),
    method,
    'MISS',
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/core-api/')) {
      return proxyToCore(request, url, (env.CORE_API_KEY ?? '').trim(), ctx);
    }
    // Everything else is the Angular app; wrangler.jsonc normally serves it
    // without invoking this Worker at all.
    return env.ASSETS.fetch(request);
  },
};
