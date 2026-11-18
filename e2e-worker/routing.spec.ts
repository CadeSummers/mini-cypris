import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FAKE_CORE = 'http://127.0.0.1:8789';

interface Call {
  method: string;
  path: string;
  hasKey: boolean;
}

async function coreCalls(request: APIRequestContext): Promise<Call[]> {
  return (await request.get(`${FAKE_CORE}/__calls`)).json();
}

test('the app is served as files and its searches go through the Worker', async ({
  page,
  request,
}) => {
  const search = page.waitForResponse((response) =>
    response.url().includes('/core-api/v3/search/works/?'),
  );
  await page.goto('/');
  await page.getByLabel('Boolean search').fill('drone AND delivery');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.locator('app-year-chart')).toContainText('All 1,234 matching papers');

  // Only the Worker adds this header, so the request did not bypass it.
  expect((await search).headers()['x-proxy-cache']).toBe('MISS');

  const calls = await coreCalls(request);
  expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual([
    'GET /v3/search/works/',
    'POST /v3/search/works/aggregate',
  ]);
  expect(
    calls.every((call) => call.hasKey),
    'the Worker did not attach the key',
  ).toBe(true);
});

test('a shared link to a search opens directly', async ({ page }) => {
  await page.goto('/?q=drone%20AND%20delivery');

  await expect(page.getByLabel('Boolean search')).toHaveValue('drone AND delivery');
  await expect(page.getByRole('article')).toHaveCount(10);
});

test('an unknown page address still loads the app', async ({ page }) => {
  const response = await page.goto('/some/page/that/does/not/exist');

  expect(response?.status()).toBe(200);
  await expect(page.getByLabel('Boolean search')).toBeVisible();
});

test('API paths always reach the Worker and never fall back to the app', async ({ request }) => {
  const before = (await coreCalls(request)).length;

  const refused = await request.get('/core-api/v3/works/123');
  expect(refused.status()).toBe(404);
  expect(refused.headers()['content-type']).toContain('application/json');
  expect((await refused.json()).message).toContain('only serves CORE work search');

  expect((await coreCalls(request)).length, 'a refused path reached CORE').toBe(before);
});

test('files are served with their own types, not through the proxy', async ({ page, request }) => {
  await page.goto('/');
  const script = await page.locator('script[src]').first().getAttribute('src');
  expect(script).toBeTruthy();

  const file = await request.get(`/${script}`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toContain('javascript');
  expect(file.headers()['x-proxy-cache']).toBeUndefined();
});

// Last on purpose: it uses up this visitor's allowance for the next minute.
test('the fifth new search in a minute shows the demo limit message', async ({ page, request }) => {
  await page.goto('/');
  const alert = page.getByRole('alert');

  // Each new search costs two CORE requests; the tests above have already spent some.
  for (let i = 1; i <= 5; i += 1) {
    await page.getByLabel('Boolean search').fill(`limit check ${i}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('article').first().or(alert)).toBeVisible();
    if (await alert.isVisible()) break;
  }

  await expect(alert.getByRole('heading')).toHaveText('Search limit reached');
  await expect(alert).toContainText('Searches will be accepted again at');
  expect(await coreCalls(request), 'CORE must see exactly the 8 allowed requests').toHaveLength(8);
});
