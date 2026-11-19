import type { Page } from '@playwright/test';
import { searchResponse } from './fixtures';
import { expect, test } from './mock-core';

const queryBox = (page: Page) => page.getByLabel('Boolean search');
const cards = (page: Page) => page.getByRole('article');
const suggestions = (page: Page) => page.locator('app-suggestions');

const RELATED = ['uav AND parcel', 'drone AND logistics', 'drone AND regulation'];

async function search(page: Page, query: string): Promise<void> {
  await page.goto('/');
  await queryBox(page).fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test('a search that finds nothing offers a spelling correction, and clicking it searches', async ({
  page,
  core,
  ai,
}) => {
  core.onSearch((call) => ({
    body: searchResponse(call.limit, call.offset, call.q.includes('Abiogenisis') ? 0 : 1234),
  }));
  ai.onAsk((call) =>
    call.mode === 'correct'
      ? { body: { ok: true, queries: ['abiogenesis AND exoplanet'] } }
      : { body: { ok: true, queries: ['astrobiology AND exoplanet'] } },
  );

  await search(page, '"Abiogenisis" AND "Exoplanet"');

  const suggestion = page.getByRole('button', { name: 'abiogenesis AND exoplanet' });
  await expect(suggestion).toBeVisible();
  await expect(suggestions(page)).toContainText('Did you mean');
  // With nothing found, other searches are offered too.
  await expect(suggestions(page)).toContainText('Similar searches to try');
  await expect(page.getByRole('button', { name: 'astrobiology AND exoplanet' })).toBeVisible();
  expect(ai.calls).toEqual(
    expect.arrayContaining([
      { mode: 'correct', text: 'Abiogenisis AND Exoplanet' },
      { mode: 'related', text: 'Abiogenisis AND Exoplanet' },
    ]),
  );
  expect(ai.calls).toHaveLength(2);
  // The suggestions are only offered; nothing new was searched yet.
  expect(core.searches).toHaveLength(1);

  await suggestion.click();
  await expect(cards(page)).toHaveCount(10);
  await expect(queryBox(page)).toHaveValue('abiogenesis AND exoplanet');
  expect(core.searches.at(-1)?.q).toBe('abiogenesis AND exoplanet');
});

test('related searches appear by themselves, after the papers', async ({ page, core, ai }) => {
  // The model answers slowly; the papers must not wait for it.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  ai.onAsk(() => ({ body: { ok: true, queries: RELATED } }));
  await page.route('**/ai/query', async (route) => {
    await held;
    await route.fallback();
  });

  await search(page, 'drone AND delivery');
  await expect(cards(page)).toHaveCount(10);
  await expect(suggestions(page)).toContainText('Thinking of related searches');

  release();
  await expect(suggestions(page).getByRole('button')).toHaveText(RELATED);
  expect(ai.calls).toEqual([{ mode: 'related', text: 'drone AND delivery' }]);

  // Narrowing the same query, or loading more of it, asks the model nothing new.
  await page.getByRole('button', { name: 'Load 10 more' }).click();
  await expect(cards(page)).toHaveCount(20);
  expect(ai.calls).toHaveLength(1);

  await page.getByRole('button', { name: 'drone AND logistics' }).click();
  await expect(queryBox(page)).toHaveValue('drone AND logistics');
  expect(core.searches.at(-1)?.q).toBe('drone AND logistics');
  await expect
    .poll(() => ai.calls.at(-1))
    .toEqual({ mode: 'related', text: 'drone AND logistics' });
});

test('a search CORE fails on says no papers were found and offers similar searches', async ({
  page,
  core,
  ai,
}) => {
  core.onSearch((call) =>
    call.q.includes('broken')
      ? { status: 500, body: { message: 'Internal Server Error' } }
      : { body: searchResponse(call.limit, call.offset) },
  );
  ai.onAsk((call) =>
    call.mode === 'related'
      ? { body: { ok: true, queries: RELATED } }
      : { body: { ok: false, reason: 'unclear' } },
  );

  await search(page, 'broken AND query');

  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading')).toHaveText('No papers found');
  await expect(alert).toContainText('CORE answered with an error (500)');
  await expect(suggestions(page)).toContainText('Similar searches to try');
  await expect(suggestions(page).getByRole('button')).toHaveText(RELATED);

  await page.getByRole('button', { name: 'uav AND parcel' }).click();
  await expect(cards(page)).toHaveCount(10);
  await expect(queryBox(page)).toHaveValue('uav AND parcel');
});

test('a rate limit offers no similar searches, since another query would not get through', async ({
  page,
  core,
  ai,
}) => {
  core.onSearch(() => ({ status: 429, body: {} }));
  await search(page, 'drone AND delivery');

  await expect(page.getByRole('alert').getByRole('heading')).toHaveText('CORE rate limit reached');
  await expect(suggestions(page)).toHaveCount(0);
  expect(ai.calls).toEqual([]);
});

test('no spelling correction is asked for when a chart filter caused the empty list', async ({
  page,
  core,
  ai,
}) => {
  core.onSearch((call) => ({
    body: searchResponse(call.limit, call.offset, call.q.includes('yearPublished') ? 0 : 1234),
  }));
  await page.goto('/?q=drone&year=2023');

  await expect(page.getByRole('heading', { name: 'No papers matched' })).toBeVisible();
  await expect.poll(() => ai.calls).toEqual([{ mode: 'related', text: 'drone' }]);
});

test('when the model has had too many requests the page says so and when to come back', async ({
  page,
  ai,
}) => {
  let limited = true;
  ai.onAsk(() =>
    limited
      ? {
          status: 429,
          headers: {
            'x-proxy-limit': 'visitor',
            'x-ratelimit-retry-after': new Date(Date.now() + 45_000).toISOString(),
          },
          body: {},
        }
      : { body: { ok: true, queries: RELATED } },
  );
  await search(page, 'drone AND delivery');

  await expect(cards(page)).toHaveCount(10);
  await expect(suggestions(page)).toContainText(
    /The AI model \(Llama\) has received too many requests from you in a short time\.\s+It will take requests again in about 50 seconds, at \d/,
  );

  limited = false;
  await suggestions(page).getByRole('button', { name: 'Try again' }).click();
  await expect(suggestions(page).getByRole('button')).toHaveText(RELATED);
});

test("when the model's daily allowance is used up the page says it is not the visitor", async ({
  page,
  ai,
}) => {
  ai.onAsk(() => ({
    status: 429,
    headers: {
      'x-proxy-limit': 'model',
      'x-ratelimit-retry-after': new Date(Date.now() + 5 * 3600_000 - 60_000).toISOString(),
    },
    body: {},
  }));
  await search(page, 'drone AND delivery');

  await expect(suggestions(page)).toContainText(
    /too many requests from all visitors of this demo\.\s+It will take requests again in about 5 hours, at \d/,
  );
});

test('if suggestions are unavailable the page says so and still works', async ({ page, ai }) => {
  ai.onAsk(() => ({ status: 503, body: {} }));
  await search(page, 'drone AND delivery');

  await expect(page.getByText('Suggestions are unavailable right now')).toBeVisible();
  await expect(cards(page)).toHaveCount(10);
});
