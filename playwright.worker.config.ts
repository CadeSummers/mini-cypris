import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Routing tests: the production build and the Cloudflare Worker run together
 * under `wrangler dev`, exactly as wrangler.jsonc describes them, and the
 * Worker talks to a fake CORE. This covers what the other suites cannot: which
 * requests reach the Worker and which are served as files.
 */
const APP_PORT = 8788;
const CORE_PORT = 8789;
const TEST_KEY = 'routing-test-key-not-a-real-secret';
const isCI = !!process.env['CI'];

// A new folder each run, so the Worker's cache and visitor counts start empty.
const state = join(tmpdir(), `mini-cypris-wrangler-${Date.now()}`);

const wrangler = [
  'npx wrangler dev',
  `--port ${APP_PORT}`,
  '--ip 127.0.0.1',
  `--var CORE_API_ORIGIN:http://127.0.0.1:${CORE_PORT}`,
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
