import type { Page } from '@playwright/test';
import { searchResponse } from './fixtures';
import { expect, test } from './mock-core';

const QUERY = '(drone AND (package OR delivery))';

const queryBox = (page: Page) => page.getByLabel('Boolean search');
const limitBox = (page: Page) => page.getByLabel('Papers to fetch');
const searchButton = (page: Page) => page.getByRole('button', { name: 'Search', exact: true });
const cards = (page: Page) => page.getByRole('article');

async function runSearch(page: Page, query = QUERY): Promise<void> {
  await page.goto('/');
  await queryBox(page).fill(query);
  await searchButton(page).click();
  await expect(cards(page)).toHaveCount(10);
}

test('a boolean search lists papers, the total, and highlights the query words', async ({
  page,
  core,
}) => {
  await runSearch(page);

  expect(core.searches).toEqual([{ q: QUERY, limit: 10, offset: 0 }]);
  await expect(page.getByRole('status')).toContainText('Showing 10 of 1,234 papers');
  await expect(page).toHaveURL(/[?&]q=/);

  const first = cards(page).first();
  await expect(first.getByRole('heading')).toHaveText(
    'Drone delivery of medical supplies in rural areas',
  );
  await expect(first.locator('h3 mark')).toHaveText(['Drone', 'delivery']);
});

test('pressing Enter in the search box runs the search', async ({ page, core }) => {
  await page.goto('/');
  await queryBox(page).fill('drone');
  await queryBox(page).press('Enter');

  await expect(cards(page)).toHaveCount(10);
  await expect(page).toHaveURL(/[?&]q=drone/);
  // Chrome also fires a native "search" event on Enter; it must not start a second navigation.
  await page.waitForTimeout(300);
  await expect(cards(page)).toHaveCount(10);
  expect(core.searches).toEqual([{ q: 'drone', limit: 10, offset: 0 }]);
});

test('the number of papers to fetch is sent to CORE and clamped to 1-100', async ({
  page,
  core,
}) => {
  await runSearch(page);

  await limitBox(page).fill('25');
  await limitBox(page).blur();
  await expect(cards(page)).toHaveCount(25);
  expect(core.searches.at(-1)).toEqual({ q: QUERY, limit: 25, offset: 0 });
  await expect(page).toHaveURL(/limit=25/);

  await limitBox(page).fill('500');
  await limitBox(page).blur();
  await expect(limitBox(page)).toHaveValue('100');
  await expect(cards(page)).toHaveCount(100);
  expect(core.searches.at(-1)).toEqual({ q: QUERY, limit: 100, offset: 0 });
});

test('an unbalanced query is explained and never sent', async ({ page, core }) => {
  await page.goto('/');
  await queryBox(page).fill('(drone AND delivery');
  await searchButton(page).click();

  await expect(queryBox(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#query-feedback')).toContainText(/parenthes/i);
  await expect(cards(page)).toHaveCount(0);
  expect(core.searches).toEqual([]);
  expect(core.aggregates).toEqual([]);
});

test('refining filters the loaded papers without asking CORE again', async ({ page, core }) => {
  await runSearch(page);

  await page.getByLabel(/Refine these/).fill('urban AND NOT airspace');

  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).getByRole('heading')).toHaveText(
    'Routing algorithms for urban drone package delivery',
  );
  await expect(page.locator('#refine-feedback')).toContainText('1 of 10 loaded papers match');
  expect(core.searches).toHaveLength(1);
});

test('load more fetches the next page and appends it', async ({ page, core }) => {
  await runSearch(page);

  await page.getByRole('button', { name: 'Load 10 more' }).click();

  await expect(cards(page)).toHaveCount(20);
  await expect(page.getByRole('status')).toContainText('Showing 20 of 1,234 papers');
  expect(core.searches.at(-1)).toEqual({ q: QUERY, limit: 10, offset: 10 });
});

test('no load-more button once every match is on screen', async ({ page, core }) => {
  core.onSearch((call) => ({ body: searchResponse(call.limit, call.offset, 4) }));
  await page.goto('/');
  await queryBox(page).fill(QUERY);
  await searchButton(page).click();

  await expect(cards(page)).toHaveCount(4);
  await expect(page.getByRole('button', { name: /Load \d+ more/ })).toHaveCount(0);
});

test('a search with no matches says so', async ({ page, core }) => {
  core.onSearch((call) => ({ body: searchResponse(call.limit, call.offset, 0) }));
  await page.goto('/');
  await queryBox(page).fill('zzzz');
  await searchButton(page).click();

  await expect(page.getByRole('heading', { name: 'No papers matched' })).toBeVisible();
});

test('a search opens from its URL, and Back returns to the previous search', async ({
  page,
  core,
}) => {
  await page.goto('/?q=drone&limit=5');

  await expect(cards(page)).toHaveCount(5);
  await expect(queryBox(page)).toHaveValue('drone');
  await expect(limitBox(page)).toHaveValue('5');
  expect(core.searches).toEqual([{ q: 'drone', limit: 5, offset: 0 }]);

  await queryBox(page).fill('robot');
  await searchButton(page).click();
  await expect(page.getByRole('status')).toContainText('robot');
  await expect(page).toHaveURL(/q=robot/);

  await page.goBack();
  await expect(queryBox(page)).toHaveValue('drone');
  await expect(page.getByRole('status')).toContainText('drone');
  // The earlier search is remembered, so going back costs no request.
  expect(core.searches).toHaveLength(2);
});

test('quotes around single words are removed on the way to CORE, which fails on them', async ({
  page,
  core,
}) => {
  await runSearch(page, '"Abiogenesis" AND "Exoplanet"');

  expect(core.searches.at(-1)?.q).toBe('Abiogenesis AND Exoplanet');
  expect(core.aggregates.at(-1)?.q).toBe('Abiogenesis AND Exoplanet');
  // What the user typed is left as it was.
  await expect(queryBox(page)).toHaveValue('"Abiogenesis" AND "Exoplanet"');
});

test('the previous papers stay on screen, dimmed, until the new ones arrive', async ({
  page,
  core,
}) => {
  await runSearch(page);
  const firstTitle = await cards(page).first().getByRole('heading').innerText();

  // Hold the next search so the in-between state can be looked at.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/search/works/?*', async (route) => {
    await held;
    await route.fallback();
  });
  core.onSearch((call) => ({ body: searchResponse(call.limit, call.offset, 3) }));
  await queryBox(page).fill('another AND query');
  await searchButton(page).click();

  const stale = page.locator('.paper-list.stale');
  await expect(stale).toBeVisible();
  await expect(stale.locator('article')).toHaveCount(10);
  await expect(stale.locator('article').first()).toContainText(firstTitle);
  // Dimmed, and switched off for the mouse, the keyboard and screen readers.
  await expect(stale).toHaveCSS('opacity', '0.45');
  await expect(stale).toHaveAttribute('inert', '');
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Searching CORE for another AND query');

  release();
  await expect(page.locator('.paper-list.stale')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(3);
});

test('the first search shows placeholders, since there is nothing earlier to keep', async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/search/works/?*', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/');
  await queryBox(page).fill(QUERY);
  await searchButton(page).click();

  await expect(page.locator('.skeleton')).toHaveCount(3);
  await expect(page.locator('.paper-list.stale')).toHaveCount(0);
  release();
  await expect(cards(page)).toHaveCount(10);
});

test('an author filter is sent to the field CORE really searches', async ({ page, core }) => {
  await runSearch(page, 'drone AND authors:"Alkouz, Balsam"');

  expect(core.searches.at(-1)?.q).toBe('drone AND authors/name:"Alkouz, Balsam"');
  // What the user typed is left as it was.
  await expect(queryBox(page)).toHaveValue('drone AND authors:"Alkouz, Balsam"');
});

test('a wrong field name gets a one-click fix', async ({ page, core }) => {
  await page.goto('/');
  await queryBox(page).fill('drone and year>=2020');

  await page.getByRole('button', { name: 'Use AND' }).click();
  await page.getByRole('button', { name: 'Use yearPublished' }).click();
  await expect(queryBox(page)).toHaveValue('drone AND yearPublished>=2020');
  expect(core.searches).toEqual([]);
});
