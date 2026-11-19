import type { Page } from '@playwright/test';
import { expect, test } from './mock-core';

const cards = (page: Page) => page.getByRole('article');
const titles = (page: Page) => page.getByRole('article').getByRole('heading');

/** The mocked CORE gives paper N the DOI 10.0000/example.N. */
const doi = (n: number) => `10.0000/example.${n}`;

const FULL = {
  citations: 136,
  fwci: 12.41,
  percentile: 99,
  rcr: 1.97,
  author: { name: 'Xueping Li', hIndex: 37 },
  journal: { name: 'Drones', hIndex: 103 },
  publisher: { name: 'Example Press', hIndex: 893 },
};

async function search(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Boolean search').fill('drone AND delivery');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(cards(page)).toHaveCount(10);
}

test('papers with citation data show it; papers without stay as they were', async ({
  page,
  metrics,
}) => {
  metrics.onLookUp(() => ({
    body: { metrics: { [doi(1)]: FULL, [doi(2)]: { citations: 3 }, [doi(3)]: null } },
  }));
  await search(page);

  await expect(cards(page).nth(0).locator('.metric')).toHaveText([
    /Citations\s*136/,
    /FWCI\s*12\.41/,
    /RCR\s*1\.97/,
    /Author h-index\s*37 \(Xueping Li\)/,
    /Journal h-index\s*103/,
    /Publisher h-index\s*893/,
  ]);
  await expect(cards(page).nth(1).locator('.metric')).toHaveText([/Citations\s*3/]);
  await expect(cards(page).nth(2).locator('.metric')).toHaveCount(0);

  // One request, carrying only the DOIs of the papers on screen.
  expect(metrics.calls).toEqual([Array.from({ length: 10 }, (_, i) => doi(i + 1))]);
  await expect(page.locator('.impact-note')).toContainText(
    'Citation data for 2 of 10 loaded papers, from OpenAlex and NIH iCite',
  );

  await page.getByText('What do these numbers mean?').click();
  await expect(page.locator('.impact-help')).toContainText('Field-Weighted Citation Impact');
});

test('sorting by citations reorders the loaded papers and puts those without data last', async ({
  page,
  core,
  metrics,
}) => {
  metrics.onLookUp(() => ({
    body: {
      metrics: {
        [doi(1)]: { citations: 5, fwci: 0.5 },
        [doi(3)]: { citations: 400, fwci: 2 },
        [doi(4)]: { citations: 20, fwci: 9 },
      },
    },
  }));
  await search(page);
  const order = async () => (await titles(page).allInnerTexts()).slice(0, 4);
  const relevance = await order();

  await page.getByLabel('Sort loaded papers by').selectOption('citations');
  await expect(titles(page).first()).toHaveText('Battery limits of delivery drones');
  expect(await order()).toEqual([relevance[2], relevance[3], relevance[0], relevance[1]]);

  await page.getByLabel('Sort loaded papers by').selectOption('fwci');
  expect(await order()).toEqual([relevance[3], relevance[2], relevance[0], relevance[1]]);

  await page.getByLabel('Sort loaded papers by').selectOption('relevance');
  expect(await order()).toEqual(relevance);

  // Sorting happens in the browser: no new search and no new lookup.
  expect(core.searches).toHaveLength(1);
  expect(metrics.calls).toHaveLength(1);
});

test('load more asks only about the new papers', async ({ page, metrics }) => {
  await search(page);
  await page.getByRole('button', { name: 'Load 10 more' }).click();
  await expect(cards(page)).toHaveCount(20);

  expect(metrics.calls).toHaveLength(2);
  expect(metrics.calls[1]).toEqual(Array.from({ length: 10 }, (_, i) => doi(i + 11)));
});

test('when no paper has citation data the page says why, and offers no sorting', async ({
  page,
}) => {
  await search(page);

  await expect(page.locator('.impact-note')).toContainText('No citation data for these papers');
  await expect(page.getByLabel('Sort loaded papers by')).toHaveCount(0);
});

test('if citation metrics are unavailable the papers are still listed', async ({
  page,
  metrics,
}) => {
  metrics.onLookUp(() => ({ status: 503, body: { message: 'unavailable' } }));
  await search(page);

  await expect(page.locator('.impact-note')).toContainText(
    'Citation metrics are unavailable right now',
  );
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the publisher and author charts can be viewed as a table with citation context', async ({
  page,
  core,
  metrics,
}) => {
  metrics.onLookUp(() => ({
    body: {
      metrics: {
        [doi(1)]: { ...FULL, author: { name: 'Sam Example', hIndex: 37 } },
        [doi(2)]: { citations: 3 },
      },
    },
  }));
  await search(page);
  const switcher = page.getByRole('group', { name: 'Chart the matching papers by' });
  const ranked = page.locator('app-ranked-chart');
  const cells = (name: string | RegExp) => ranked.getByRole('row', { name }).getByRole('cell');

  // CORE's top publishers are counted over every match; none of the loaded papers is theirs.
  await switcher.getByRole('button', { name: 'Publisher' }).click();
  await ranked.getByText('View as table').click();
  await expect(ranked.getByRole('columnheader')).toHaveText([
    'Publisher',
    'Papers',
    'Loaded papers',
    'Citations',
    'h-index',
  ]);
  await expect(cells('Aerial Systems Society')).toHaveText(['412', '0', /no data/, /no data/]);

  // Document types have no citation context, so no table.
  await switcher.getByRole('button', { name: 'Document type' }).click();
  await expect(ranked.getByText('View as table')).toHaveCount(0);

  // In the fallback the chart ranks the loaded papers, so every row has context.
  core.onAggregate(() => ({ status: 500, body: {} }));
  await page.getByLabel('Boolean search').fill('another query');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(cards(page)).toHaveCount(10);
  await switcher.getByRole('button', { name: 'Author' }).click();
  await ranked.getByText('View as table').click();
  await expect(cells('Sam Example')).toHaveText(['10', '10', '139', '37']);
  await expect(cells(/^Author 1 /)).toHaveText(['1', '1', '136', /no data/]);
});
