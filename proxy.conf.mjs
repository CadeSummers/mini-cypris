// Dev-server proxy for the CORE API.
//
// The browser calls /core-api/...; this proxy forwards to api.core.ac.uk and,
// if a key is available, attaches it as a Bearer token. The key therefore never
// reaches the browser bundle or the repository. Without a key the requests are
// sent anonymously; CORE then refuses most of them (see the README), and the
// app shows its rate-limit message.
import { existsSync, readFileSync } from 'node:fs';

function readApiKey() {
  if (process.env.CORE_API_KEY) return process.env.CORE_API_KEY.trim();
  if (!existsSync('.env')) return '';
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('CORE_API_KEY='));
  if (!line) return '';
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

/**
 * Plain-English search, suggestions and citation metrics run on a Cloudflare
 * Worker (worker/ai-query.js, worker/paper-metrics.js). Under `npm start` those
 * two paths go to the deployed demo by default, so the app runs with no
 * Cloudflare account; they then count against the demo's limits. Set
 * WORKER_ORIGIN to send them elsewhere, for example to `npm run preview`
 * (http://localhost:8787, which needs a Cloudflare login for the model).
 */
const workerOrigin =
  process.env.WORKER_ORIGIN?.trim() || 'https://mini-cypris.cadetsummers.workers.dev';

const apiKey = readApiKey();
console.log(
  apiKey
    ? '[proxy] CORE API key loaded; requests are authenticated.'
    : '[proxy] No CORE_API_KEY found; CORE refuses most anonymous searches. See "API key" in the README.',
);
console.log(`[proxy] /ai and /metrics go to ${workerOrigin}`);

export default {
  '/core-api': {
    target: 'https://api.core.ac.uk',
    changeOrigin: true,
    secure: true,
    pathRewrite: { '^/core-api': '' },
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  },
  // If the Worker cannot be reached, those features say so and the rest of the
  // app is unaffected.
  '/ai': { target: workerOrigin, changeOrigin: true, secure: true },
  '/metrics': { target: workerOrigin, changeOrigin: true, secure: true },
};
