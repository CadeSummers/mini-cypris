// Production counterpart of proxy.conf.mjs, run as a Cloudflare Worker.
//
// The deployed app calls /core-api/... exactly as it does in development. This
// Worker forwards the two CORE endpoints the app uses and attaches the API key
// from an encrypted Worker secret, so the key never reaches the browser.
//
// It is deliberately not an open proxy: anything other than the search and
// aggregate endpoints is refused, so the key cannot be used for other calls.

import { DurableObject } from 'cloudflare:workers';
import { handleAiQuery } from './ai-query.js';
import { handlePaperMetrics } from './paper-metrics.js';

const CORE_ORIGIN = 'https://api.core.ac.uk';

/**
 * Where CORE requests go. Always the real API unless the CORE_API_ORIGIN
 * variable is set, which only the routing tests do (to point at a fake CORE).
 * It is not in wrangler.jsonc, so the deployed Worker never has it.
 */
function coreOrigin(env) {
  return (env.CORE_API_ORIGIN ?? '').trim() || CORE_ORIGIN;
}

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

/**
 * Each visitor may cause this many CORE requests per minute. CORE allows the
 * shared key about 10 a minute, so without this one busy visitor could lock
 * everyone else out; 8 leaves a little room. Answers served from the cache
 * above are free and never counted.
 */
const VISITOR_LIMIT = 8;
const VISITOR_WINDOW_MS = 60_000;

/**
 * All visitors together may cause this many CORE requests per minute. It is
 * CORE's own allowance for the shared key: asking for more only earns a
 * refusal from CORE, which can come with a much longer wait than a minute.
 * A deployment with a larger CORE allowance can raise it with the
 * CORE_SHARED_LIMIT variable.
 */
const SHARED_LIMIT = 10;

/** The query parameters and aggregate fields the app uses; nothing else is forwarded. */
const SEARCH_PARAMS = ['q', 'limit', 'offset'];
const AGGREGATE_FIELDS = ['yearPublished', 'documentType', 'publisher', 'authors'];

/** A positive number from a Worker variable, or the default when it is unset or not one. */
function numberSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Tells the app that this Worker, not CORE, refused the request. */
const LIMIT_HEADER = 'x-proxy-limit';

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

/**
 * Counts one visitor's CORE requests. Cloudflare runs a single instance of
 * this object per visitor (per IP address), so the count is exact however
 * many Worker instances are serving requests around the world.
 *
 * It is a sliding window: the times of the visitor's recent requests are kept,
 * and a new one is allowed only if fewer than `limit` fall inside the window.
 */
export class VisitorLimiter extends DurableObject {
  /** Returns whether one more request is allowed and, if not, when to retry. */
  async take(limit, windowMs) {
    const now = Date.now();
    const stored = (await this.ctx.storage.get('times')) ?? [];
    const recent = stored.filter((time) => now - time < windowMs);

    if (recent.length >= limit) {
      // The oldest request in the window is the next one to expire.
      return { allowed: false, retryAt: recent[0] + windowMs };
    }

    recent.push(now);
    await this.ctx.storage.put('times', recent);
    return { allowed: true, retryAt: null };
  }
}

/**
 * Asks the limiter called `name` for permission to make one request.
 *
 * `failClosed` decides what a broken limiter means. A CORE search is served
 * anyway: the worst case is CORE's own refusal. A model call is refused
 * (`failed: true`): uncounted calls could use up the whole daily allowance.
 */
async function takeSlot(env, name, limit, windowMs, failClosed) {
  const allowed = { allowed: true, retryAt: null };
  // The binding is absent in some local setups; the proxy still works without it.
  if (!env.VISITOR_LIMITER) return allowed;

  try {
    const limiter = env.VISITOR_LIMITER.get(env.VISITOR_LIMITER.idFromName(name));
    return await limiter.take(limit, windowMs);
  } catch {
    return failClosed ? { allowed: false, retryAt: null, failed: true } : allowed;
  }
}

/**
 * One visitor's count. `scope` gives a separate count per kind of request:
 * CORE searches and model calls each have their own.
 */
async function takeVisitorSlot(
  request,
  env,
  scope = '',
  limit = VISITOR_LIMIT,
  failClosed = false,
) {
  // Set by Cloudflare itself, so a visitor cannot spoof it to dodge the limit.
  const visitor = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return takeSlot(env, scope + visitor, limit, VISITOR_WINDOW_MS, failClosed);
}

/**
 * The count all visitors share. Without it, several visitors each inside
 * their own limit (or one script changing address) could use up an allowance
 * that belongs to everyone.
 */
async function takeSharedSlot(env, scope, limit, windowMs = VISITOR_WINDOW_MS, failClosed = false) {
  return takeSlot(env, `${scope}everyone`, limit, windowMs, failClosed);
}

function visitorLimitResponse(retryAt) {
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ message: 'Too many new requests from this visitor; try again shortly.' }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        [LIMIT_HEADER]: 'visitor',
        'retry-after': String(seconds),
        // Same header CORE uses, so the app's "try again at" message works unchanged.
        'x-ratelimit-retry-after': new Date(retryAt).toISOString(),
      },
    },
  );
}

function sharedLimitResponse(retryAt) {
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ message: 'This demo is busy; its shared CORE allowance is in use.' }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        [LIMIT_HEADER]: 'shared',
        'retry-after': String(seconds),
        'x-ratelimit-retry-after': new Date(retryAt).toISOString(),
      },
    },
  );
}

/**
 * The request as it will be sent to CORE: only the parameters the app uses,
 * so the key cannot be spent on options this app never asks for. Null when an
 * aggregate body is not the JSON the app sends.
 */
async function forCore(request, url) {
  if (request.method === 'GET') {
    const params = new URLSearchParams();
    for (const name of SEARCH_PARAMS) {
      const value = url.searchParams.get(name);
      if (value !== null) params.set(name, value);
    }
    return { search: `?${params}`, body: undefined };
  }

  let sent;
  try {
    sent = await request.json();
  } catch {
    return null;
  }
  if (typeof sent?.q !== 'string' || !Array.isArray(sent.aggregations)) return null;
  const aggregations = sent.aggregations.filter((field) => AGGREGATE_FIELDS.includes(field));
  return { search: '', body: JSON.stringify({ q: sent.q, aggregations }) };
}

async function proxyToCore(request, url, env, ctx) {
  const method = request.method;
  const path = url.pathname.replace(/^\/core-api/, '');
  if (!ALLOWED[method]?.includes(path)) {
    return json(404, 'This proxy only serves CORE work search and aggregation.');
  }

  const outgoing = await forCore(request, url);
  if (!outgoing) return json(400, 'Send a query and the fields to count as JSON.');
  const { search, body } = outgoing;

  const cache = caches.default;
  const cacheKey = await cacheKeyFor(
    method,
    new URL(`${url.origin}${url.pathname}${search}`),
    body,
  );
  const cached = await cache.match(cacheKey);
  if (cached) return forClient(cached, method, 'HIT');

  // Only requests that will actually reach CORE count: first against the
  // visitor, then against the allowance all visitors share.
  const slot = await takeVisitorSlot(request, env);
  if (!slot.allowed) return visitorLimitResponse(slot.retryAt);
  const shared = await takeSharedSlot(
    env,
    'core:',
    numberSetting(env.CORE_SHARED_LIMIT, SHARED_LIMIT),
  );
  if (!shared.allowed) return sharedLimitResponse(shared.retryAt);

  const apiKey = (env.CORE_API_KEY ?? '').trim();
  const headers = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let upstream;
  try {
    upstream = await fetch(`${coreOrigin(env)}${path}${search}`, { method, headers, body });
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
      return proxyToCore(request, url, env, ctx);
    }
    if (url.pathname === '/metrics' || url.pathname.startsWith('/metrics/')) {
      return handlePaperMetrics(request, url, env, ctx, { takeVisitorSlot, visitorLimitResponse });
    }
    if (url.pathname.startsWith('/ai/')) {
      return handleAiQuery(request, url, env, ctx, {
        sha256Hex,
        numberSetting,
        takeVisitorSlot,
        takeSharedSlot,
        visitorLimitResponse,
      });
    }
    // Everything else is the Angular app; wrangler.jsonc normally serves it
    // without invoking this Worker at all.
    return env.ASSETS.fetch(request);
  },
};
