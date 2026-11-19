// Dev-server proxy for the CORE API.
//
// The browser calls /core-api/...; this proxy forwards to api.core.ac.uk and,
// if a key is available, attaches it as a Bearer token. The key therefore never
// reaches the browser bundle or the repository. Without a key the app still
// works, at CORE's lower anonymous rate limit.
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

const apiKey = readApiKey();
console.log(
  apiKey
    ? '[proxy] CORE API key loaded; requests are authenticated.'
    : '[proxy] No CORE_API_KEY found; using anonymous access (lower rate limit).',
);

export default {
  '/core-api': {
    target: 'https://api.core.ac.uk',
    changeOrigin: true,
    secure: true,
    pathRewrite: { '^/core-api': '' },
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  },
  // Plain-English search needs a language model, which runs on Cloudflare (see
  // worker/ai-query.js). In development the request goes to the deployed
  // Worker, so `npm start` needs no Cloudflare account. If it cannot be
  // reached, the box says so and the rest of the app is unaffected.
  '/ai': {
    target: 'https://mini-cypris.cadetsummers.workers.dev',
    changeOrigin: true,
    secure: true,
  },
};
