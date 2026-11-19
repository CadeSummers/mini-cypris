import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Routing tests: the production build and the Cloudflare Worker run together
 * under `wrangler dev`, exactly as wrangler.jsonc describes them, and the
 * Worker talks to a fake CORE and a fake language model. This covers what the other suites cannot: which
 * requests reach the Worker and which are served as files.
 */
const APP_PORT = 8788;
const CORE_PORT = 8789;
const TEST_KEY = 'routing-test-key-not-a-real-secret';
const isCI = !!process.env['CI'];

// A new folder each run, so the Worker's cache and visitor counts start empty.
const state = join(tmpdir(), `mini-cypris-wrangler-${Date.now()}`);

// The same wrangler.jsonc as production, minus the AI binding: wrangler connects
// to Cloudflare for that binding even in local dev, which needs a login that CI
// does not have. The Worker reaches a fake model through AI_ORIGIN instead.
const TEST_CONFIG = 'wrangler.e2e.jsonc';
const production = readFileSync('wrangler.jsonc', 'utf8');
const withoutAi = production.replace(/^ *"ai":.*$/m, '');
if (withoutAi === production) throw new Error('wrangler.jsonc no longer has the "ai" line');
writeFileSync(TEST_CONFIG, withoutAi);

const wrangler = [
  'npx wrangler dev',
  `--config ${TEST_CONFIG}`,
  `--port ${APP_PORT}`,
  '--ip 127.0.0.1',
  `--var CORE_API_ORIGIN:http://127.0.0.1:${CORE_PORT}`,
  `--var AI_ORIGIN:http://127.0.0.1:${CORE_PORT}`,
  `--var CORE_API_KEY:${TEST_KEY}`,
  `--persist-to "${state}"`,
  '--show-interactive-dev-session=false',
].join(' ');

export default defineConfig({
  testDir: 'e2e-worker',
  // One at a time and in order: the tests share one visitor allowance in the Worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e-worker/fake-core.ts',
      url: `http://127.0.0.1:${CORE_PORT}/__calls`,
      env: { FAKE_CORE_PORT: String(CORE_PORT), FAKE_CORE_KEY: TEST_KEY },
      reuseExistingServer: false,
    },
    {
      command: `npm run build && ${wrangler}`,
      url: `http://127.0.0.1:${APP_PORT}`,
      env: { WRANGLER_SEND_METRICS: 'false' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
