import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './mock-core';

/** Automated checks catch only part of accessibility, but they catch regressions cheaply. */
const summarise = (violations: { id: string; nodes: { target: unknown }[] }[]) =>
  violations.map((violation) => `${violation.id}: ${JSON.stringify(violation.nodes[0]?.target)}`);

test('the empty page has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Boolean search')).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(summarise(results.violations)).toEqual([]);
});

test('a page of results has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/?q=drone%20AND%20delivery');
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.locator('app-year-chart')).toContainText('matching papers');

  const results = await new AxeBuilder({ page }).analyze();
  expect(summarise(results.violations)).toEqual([]);
});
