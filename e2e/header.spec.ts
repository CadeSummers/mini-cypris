import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './mock-core';

test('the logo and name are one link that returns to the empty start page', async ({ page }) => {
  await page.goto('/?q=drone%20AND%20delivery&year=2023');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publisher' }).click();

  const home = page.getByRole('link', { name: /Mini-Cypris/ });
  await expect(home).toHaveCount(1);
  await expect(home.locator('img')).toBeVisible();
  expect(
    await home.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await home.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByLabel('Boolean search')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Year', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Enter a query above')).toBeVisible();
});

test('the theme switch changes the palette and the choice survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  const toggle = page.getByRole('switch', { name: 'Dark mode' });
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const light = await background();

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await background()).not.toBe(light);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('with no saved choice the page follows the device setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('a page of results in dark mode has no detectable accessibility violations', async ({
  page,
  metrics,
}) => {
  metrics.onLookUp(() => ({
    body: {
      metrics: {
        '10.0000/example.1': {
          citations: 136,
          fwci: 12.41,
          author: { name: 'Xueping Li', hIndex: 37 },
        },
      },
    },
  }));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?q=drone%20AND%20delivery');
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.locator('app-year-chart')).toContainText('matching papers');

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${JSON.stringify(v.nodes.map((n) => n.target))}`),
  ).toEqual([]);
});
