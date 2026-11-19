import type { Page } from '@playwright/test';
import { expect, test } from './mock-core';

const QUESTION = 'show me papers about abiogenesis and exoplanets published after 2000';
const WRITTEN = 'abiogenesis AND exoplanet AND yearPublished>2000';

const questionBox = (page: Page) => page.getByLabel('Better yet, ask me in plain English');
const queryBox = (page: Page) => page.getByLabel('Boolean search');
const cards = (page: Page) => page.getByRole('article');

async function ask(page: Page, question = QUESTION): Promise<void> {
  await page.goto('/');
  await questionBox(page).fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}

test('a plain-English question becomes a boolean query and runs it', async ({ page, core, ai }) => {
  ai.onAsk(() => ({ body: { ok: true, queries: [WRITTEN] } }));
  await ask(page);

  await expect(cards(page)).toHaveCount(10);
  expect(ai.calls[0]).toEqual({ mode: 'translate', text: QUESTION });
  expect(core.searches).toEqual([{ q: WRITTEN, limit: 10, offset: 0 }]);

  // The query is in plain sight: in the Boolean box, in the URL and in a note.
  await expect(queryBox(page)).toHaveValue(WRITTEN);
  await expect(page).toHaveURL(/[?&]q=abiogenesis/);
  await expect(page.getByText('written from your question')).toBeVisible();

  // Reloading the link runs the search again without asking for the query to be written again.
  await page.reload();
  await expect(cards(page)).toHaveCount(10);
  expect(ai.calls.filter((call) => call.mode === 'translate')).toHaveLength(1);
});

test('a request that is not a paper search is refused and nothing is searched', async ({
  page,
  core,
  ai,
}) => {
  ai.onAsk(() => ({ body: { ok: false, reason: 'not_a_search' } }));
  await ask(page, 'write me a poem about drones');

  await expect(page.getByText('does not look like a request for research papers')).toBeVisible();
  expect(core.searches).toEqual([]);
  await expect(queryBox(page)).toHaveValue('');
});

test('whatever the endpoint returns, only a query the search box accepts is run', async ({
  page,
  core,
  ai,
}) => {
  ai.onAsk(() => ({ body: { ok: true, queries: ['(this is not AND a valid query'] } }));
  await ask(page);

  await expect(page.getByText('could not be turned into a search')).toBeVisible();
  expect(core.searches).toEqual([]);
});

test('when the model is unavailable the Boolean box still works', async ({ page, core, ai }) => {
  ai.onAsk(() => ({ status: 503, body: { message: 'unavailable' } }));
  await ask(page);

  await expect(page.getByText('Plain-English search is unavailable right now')).toBeVisible();

  await queryBox(page).fill('drone');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(cards(page)).toHaveCount(10);
  expect(core.searches).toHaveLength(1);
});

test('asking too often is explained with the time to try again', async ({ page, ai }) => {
  ai.onAsk(() => ({
    status: 429,
    headers: {
      'x-proxy-limit': 'visitor',
      'x-ratelimit-retry-after': new Date(Date.now() + 45_000).toISOString(),
    },
    body: { message: 'Too many new requests' },
  }));
  await ask(page);

  await expect(page.locator('#question-feedback')).toContainText(
    /The AI model \(Llama\) has received too many requests from you in a short time\.\s+It will take requests again in about 50 seconds, at \d/,
  );
});
