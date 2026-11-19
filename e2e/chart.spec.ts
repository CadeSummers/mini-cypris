import type { Page } from '@playwright/test';
import { searchResponse } from './fixtures';
import { expect, test } from './mock-core';

const QUERY = 'drone AND delivery';

const cards = (page: Page) => page.getByRole('article');
const yearChart = (page: Page) => page.locator('app-year-chart');

async function runSearch(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Boolean search').fill(QUERY);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(cards(page)).toHaveCount(10);
}

test('the chart counts every matching paper, not just the loaded ones', async ({ page, core }) => {
  await runSearch(page);

  expect(core.aggregates).toEqual([
    { q: QUERY, aggregations: ['yearPublished', 'documentType', 'publisher', 'authors'] },
  ]);
  // 60 + 95 + 140 + 210 + 305 + 280 + 144 in the mocked counts.
  await expect(yearChart(page)).toContainText('All 1,234 matching papers');
  await expect(yearChart(page).locator('canvas')).toBeVisible();
});

test('choosing a year lists that year and keeps the chart on the whole query', async ({
  page,
  core,
}) => {
  core.onSearch((call) => ({
    body: searchResponse(call.limit, call.offset, call.q.includes('yearPublished:2023') ? 3 : 1234),
  }));
  await runSearch(page);

  // The table is the keyboard and screen-reader route to the same action as clicking a bar.
  await yearChart(page).getByText('View as table').click();
  await page.getByRole('button', { name: 'List papers from 2023' }).click();

  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('published in 2023');
  await expect(page).toHaveURL(/year=2023/);
  expect(core.searches.at(-1)).toEqual({
    q: `(${QUERY}) AND yearPublished:2023`,
    limit: 10,
    offset: 0,
  });
  // The counts belong to the base query, so they are not fetched again.
  expect(core.aggregates).toHaveLength(1);
  await expect(yearChart(page)).toContainText('All 1,234 matching papers');

  await page.getByRole('button', { name: /Year: 2023/ }).click();
  await expect(cards(page)).toHaveCount(10);
  await expect(page).not.toHaveURL(/year=/);
});

test('the chart can rank publishers, document types and authors', async ({ page }) => {
  await runSearch(page);
  const switcher = page.getByRole('group', { name: 'Chart the matching papers by' });
  const ranked = page.locator('app-ranked-chart');

  await switcher.getByRole('button', { name: 'Publisher' }).click();
  await expect(switcher.getByRole('button', { name: 'Publisher' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(ranked.getByRole('heading')).toHaveText('Top publishers');
  await expect(ranked.getByRole('listitem').first()).toContainText('Aerial Systems Society');
  await expect(ranked.getByRole('listitem').first()).toContainText('412');
  await expect(yearChart(page)).toBeHidden();

  await switcher.getByRole('button', { name: 'Document type' }).click();
  await expect(ranked.getByRole('listitem')).toHaveCount(3);

  await switcher.getByRole('button', { name: 'Author' }).click();
  await expect(ranked.getByRole('heading')).toHaveText('Top authors');

  await switcher.getByRole('button', { name: 'Year' }).click();
  await expect(yearChart(page)).toBeVisible();
});

test('choosing a document type lists that type, and combines with a year', async ({
  page,
  core,
}) => {
  core.onSearch((call) => {
    const typed = call.q.includes('documentType:"thesis"');
    const dated = call.q.includes('yearPublished:2023');
    return { body: searchResponse(call.limit, call.offset, typed && dated ? 2 : typed ? 4 : 1234) };
  });
  await runSearch(page);
  const switcher = page.getByRole('group', { name: 'Chart the matching papers by' });
  const thesis = page.getByRole('button', { name: 'List papers of type Thesis' });

  await switcher.getByRole('button', { name: 'Document type' }).click();
  await thesis.click();

  await expect(cards(page)).toHaveCount(4);
  await expect(thesis).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).toContainText('of type Thesis');
  await expect(page).toHaveURL(/type=thesis/);
  expect(core.searches.at(-1)?.q).toBe(`(${QUERY}) AND documentType:"thesis"`);
  expect(core.aggregates).toHaveLength(1);

  // A year chosen afterwards narrows the same list further.
  await switcher.getByRole('button', { name: 'Year' }).click();
  await yearChart(page).getByText('View as table').click();
  await page.getByRole('button', { name: 'List papers from 2023' }).click();
  await expect(cards(page)).toHaveCount(2);
  expect(core.searches.at(-1)?.q).toBe(
    `(${QUERY}) AND yearPublished:2023 AND documentType:"thesis"`,
  );

  // Removing the type keeps the year.
  await page.getByRole('button', { name: /Type: Thesis/ }).click();
  await expect(cards(page)).toHaveCount(10);
  expect(core.searches.at(-1)?.q).toBe(`(${QUERY}) AND yearPublished:2023`);
  await expect(page).not.toHaveURL(/type=/);
  await expect(page).toHaveURL(/year=2023/);
});

test('choosing a publisher lists its papers, by its name or by its bar', async ({ page, core }) => {
  await runSearch(page);
  const switcher = page.getByRole('group', { name: 'Chart the matching papers by' });
  const ranked = page.locator('app-ranked-chart');

  await switcher.getByRole('button', { name: 'Publisher' }).click();
  await expect(ranked).toContainText('Click a publisher to list its papers.');
  await expect(ranked).toContainText('can also list papers CORE files under a similar name');

  // The bar itself is clickable, like a bar of the year chart.
  await ranked.getByRole('listitem').nth(1).locator('.track').click();
  await expect(page).toHaveURL(/publisher=Logistics(\+|%20)Review/);
  await expect(page.getByRole('status')).toContainText('from publisher Logistics Review');
  expect(core.searches.at(-1)?.q).toBe(`(${QUERY}) AND publisher:"Logistics Review"`);
  await expect(
    ranked.getByRole('button', { name: 'List papers from publisher Logistics Review' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // The chart still describes the whole query, and was not fetched again.
  await expect(ranked.getByRole('listitem').first()).toContainText('412');
  expect(core.aggregates).toHaveLength(1);

  // Picking another replaces it; the chip removes it.
  await ranked
    .getByRole('button', { name: 'List papers from publisher Aerial Systems Society' })
    .click();
  await expect
    .poll(() => core.searches.at(-1)?.q)
    .toBe(`(${QUERY}) AND publisher:"Aerial Systems Society"`);
  await page.getByRole('button', { name: /Publisher: Aerial Systems Society/ }).click();
  await expect(page).not.toHaveURL(/publisher=/);
  // The unfiltered list comes back from the app's own cache, with no new request.
  await expect(page.getByRole('status')).not.toContainText('from publisher');
  await expect(cards(page)).toHaveCount(10);
});

test('choosing an author lists their papers, and combines with a year', async ({ page, core }) => {
  await page.goto('/?q=drone&year=2023');
  await expect(cards(page).first()).toBeVisible();
  const switcher = page.getByRole('group', { name: 'Chart the matching papers by' });
  const ranked = page.locator('app-ranked-chart');

  await switcher.getByRole('button', { name: 'Author' }).click();
  await ranked.getByRole('button', { name: 'List papers by Rivera, Ana' }).click();

  await expect(page).toHaveURL(/author=Rivera/);
  await expect(page).toHaveURL(/year=2023/);
  await expect(page.getByRole('status')).toContainText('by Rivera, Ana');
  // Sent to the field CORE really searches author names in.
  expect(core.searches.at(-1)?.q).toBe(
    '(drone) AND yearPublished:2023 AND authors/name:"Rivera, Ana"',
  );

  // Clicking the selected bar again removes the selection.
  await ranked.getByRole('listitem').first().locator('.track').click();
  await expect(page).not.toHaveURL(/author=/);
  await expect(page).toHaveURL(/year=2023/);
});

test('a shared link with a publisher and an author opens filtered', async ({ page, core }) => {
  await page.goto('/?q=drone&publisher=Open%20Flight%20Press&author=Chen%2C%20Wei');
  await expect(cards(page).first()).toBeVisible();

  expect(core.searches.at(-1)?.q).toBe(
    '(drone) AND publisher:"Open Flight Press" AND authors/name:"Chen, Wei"',
  );
  await expect(page.getByRole('button', { name: /Publisher: Open Flight Press/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Author: Chen, Wei/ })).toBeVisible();
});

test('nothing can be picked in the fallback, where the bars count loaded papers only', async ({
  page,
  core,
}) => {
  await runSearch(page);
  const switcher = page.getByRole('group', { name: 'Chart the matching papers by' });
  const ranked = page.locator('app-ranked-chart');

  core.onAggregate(() => ({ status: 500, body: {} }));
  await page.getByLabel('Boolean search').fill('another query');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(cards(page)).toHaveCount(10);
  for (const view of ['Document type', 'Publisher', 'Author']) {
    await switcher.getByRole('button', { name: view }).click();
    await expect(ranked.getByRole('listitem').first()).toBeVisible();
    await expect(ranked.locator('ol').getByRole('button')).toHaveCount(0);
    await expect(ranked.locator('.track.clickable')).toHaveCount(0);
  }
});

test('if the counts fail, the papers still load and the chart says what it shows', async ({
  page,
  core,
}) => {
  core.onAggregate(() => ({ status: 500, body: { message: 'Aggregation failed' } }));
  await runSearch(page);

  await expect(yearChart(page)).toContainText('Only the 10 loaded papers');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
