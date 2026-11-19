import type { Page } from '@playwright/test';
import { searchResponse } from './fixtures';
import { expect, test } from './mock-core';
import type { MockCore, Reply } from './mock-core';

const cards = (page: Page) => page.getByRole('article');

/** The first search fails with `failure`; every later one succeeds. */
function failOnce(core: MockCore, failure: Reply): void {
  let failed = false;
  core.onSearch((call) => {
    if (!failed) {
      failed = true;
      return failure;
    }
    return { body: searchResponse(call.limit, call.offset) };
  });
}

async function submit(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Boolean search').fill('drone');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test("the demo's own per-visitor limit is explained, and Try again recovers", async ({
  page,
  core,
}) => {
  failOnce(core, {
    status: 429,
    headers: {
      'x-proxy-limit': 'visitor',
      'x-ratelimit-retry-after': new Date(Date.now() + 30_000).toISOString(),
    },
    body: { message: 'Too many searches' },
  });
  await submit(page);

  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading')).toHaveText('Search limit reached');
  await expect(alert).toContainText('Searches will be accepted again at');
  await expect(cards(page)).toHaveCount(0);

  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test("CORE's rate limit gets its own message", async ({ page, core }) => {
  failOnce(core, { status: 429, body: { message: 'Rate limit exceeded' } });
  await submit(page);

  await expect(page.getByRole('alert').getByRole('heading')).toHaveText('CORE rate limit reached');
});

test('a CORE outage is reported without losing the query', async ({ page, core }) => {
  failOnce(core, { status: 503, body: {} });
  await submit(page);

  await expect(page.getByRole('alert').getByRole('heading')).toHaveText('CORE is having trouble');
  await expect(page.getByLabel('Boolean search')).toHaveValue('drone');
});

test('a failed load more keeps the papers already shown', async ({ page, core }) => {
  core.onSearch((call) =>
    call.offset > 0 ? { status: 429, body: {} } : { body: searchResponse(call.limit, call.offset) },
  );
  await submit(page);
  await expect(cards(page)).toHaveCount(10);

  await page.getByRole('button', { name: 'Load 10 more' }).click();

  await expect(page.getByRole('alert').getByRole('heading')).toHaveText('CORE rate limit reached');
  await expect(cards(page)).toHaveCount(10);
});

test('a query CORE rejects with a 500 is reported as a query problem, not an outage', async ({
  page,
  core,
}) => {
  failOnce(core, {
    status: 500,
    body: { message: 'Azure search failed with status code: 400. Error context: ...' },
  });
  await submit(page);

  await expect(page.getByRole('alert').getByRole('heading')).toHaveText(
    'CORE could not understand that query',
  );
});
