import type { Page } from '@playwright/test';
import { searchResponse } from './fixtures';
import { expect, test } from './mock-core';

const queryBox = (page: Page) => page.getByLabel('Boolean search');
const cards = (page: Page) => page.getByRole('article');

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
  ai.onAsk(() => ({ body: { ok: true, queries: ['abiogenesis AND exoplanet'] } }));

  await search(page, '"Abiogenisis" AND "Exoplanet"');

  const suggestion = page.getByRole('button', { name: 'abiogenesis AND exoplanet' });
  await expect(suggestion).toBeVisible();
  await expect(page.locator('app-suggestions')).toContainText('Did you mean');
  expect(ai.calls).toEqual([{ mode: 'correct', text: 'Abiogenisis AND Exoplanet' }]);
  // The suggestion is only offered; nothing new was searched yet.
  expect(core.searches).toHaveLength(1);

  await suggestion.click();
  await expect(cards(page)).toHaveCount(10);
  await expect(queryBox(page)).toHaveValue('abiogenesis AND exoplanet');
  expect(core.searches.at(-1)?.q).toBe('abiogenesis AND exoplanet');
});

test('an ordinary search sends nothing to the model until related searches are asked for', async ({
  page,
  core,
  ai,
}) => {
  ai.onAsk(() => ({
    body: { ok: true, queries: ['uav AND parcel', 'drone AND logistics', 'drone AND regulation'] },
  }));
  await search(page, 'drone AND delivery');
  await expect(cards(page)).toHaveCount(10);
  expect(ai.calls).toEqual([]);

  await page.getByRole('button', { name: 'Suggest related searches' }).click();
  await expect(page.locator('app-suggestions').getByRole('button')).toHaveText([
    'uav AND parcel',
    'drone AND logistics',
    'drone AND regulation',
  ]);
  expect(ai.calls).toEqual([{ mode: 'related', text: 'drone AND delivery' }]);

  await page.getByRole('button', { name: 'drone AND logistics' }).click();
  await expect(queryBox(page)).toHaveValue('drone AND logistics');
  expect(core.searches.at(-1)?.q).toBe('drone AND logistics');
  // The suggestions belonged to the previous query, so the offer is back.
  await expect(page.getByRole('button', { name: 'Suggest related searches' })).toBeVisible();
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
  expect(ai.calls).toEqual([]);
});

test('if suggestions are unavailable the page says so and still works', async ({ page, ai }) => {
  ai.onAsk(() => ({ status: 503, body: {} }));
  await search(page, 'drone AND delivery');
  await page.getByRole('button', { name: 'Suggest related searches' }).click();

  await expect(page.getByText('Suggestions are unavailable right now')).toBeVisible();
  await expect(cards(page)).toHaveCount(10);
});
