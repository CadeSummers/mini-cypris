// Production counterpart of proxy.conf.mjs, run as a Netlify Function.
//
// The deployed app calls /core-api/... exactly as it does in development. This
// function forwards the two CORE endpoints the app uses and attaches the API
// key from the site's environment, so the key never reaches the browser.
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

/** Searches are safe to repeat, so let browsers and the CDN reuse them briefly. */
const CACHE_SECONDS = 300;

function json(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/core-api/, '');

  if (!ALLOWED[request.method]?.includes(path)) {
    return json(404, 'This proxy only serves CORE work search and aggregation.');
  }

  const headers = { accept: 'application/json' };
  const apiKey = (process.env.CORE_API_KEY ?? '').trim();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const init = { method: request.method, headers };
  if (request.method === 'POST') {
    headers['content-type'] = 'application/json';
    init.body = await request.text();
  }

  let upstream;
  try {
    upstream = await fetch(`${CORE_ORIGIN}${path}${url.search}`, init);
  } catch {
    return json(502, 'Could not reach the CORE API.');
  }

  const responseHeaders = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.ok && request.method === 'GET') {
    responseHeaders.set('cache-control', `public, max-age=${CACHE_SECONDS}`);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const config = { path: '/core-api/*' };
