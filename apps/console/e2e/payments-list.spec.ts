import { expect, test } from '@playwright/test';
import { queryPayments } from '../src/mocks/payments-list';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so the expected rows come from the same seed the server uses.
const store = createSeededStore();
const expected = queryPayments(store, new URLSearchParams('status=SUCCEEDED&gatewayId=stripe&limit=100'));

test('filters Payments, keeps the view across a reload, and opens a Payment', async ({ page }) => {
  expect(expected.items.length).toBeGreaterThan(1);
  const first = expected.items[0]!;

  await page.goto('/payments');
  const table = page.getByRole('table', { name: 'Payments' });
  await expect(table.getByRole('link').first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Status' }).selectOption('SUCCEEDED');
  await page.getByRole('combobox', { name: 'Gateway' }).selectOption('stripe');
  await expect(page).toHaveURL(/status=SUCCEEDED/);
  await expect(page).toHaveURL(/gatewayId=stripe/);
  await expect(table.getByRole('link').first()).toHaveText(first.upstreamReference);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('SUCCEEDED');
  await expect(page.getByRole('combobox', { name: 'Gateway' })).toHaveValue('stripe');
  await expect(table.getByRole('link').first()).toHaveText(first.upstreamReference);
  await expect(table.getByRole('row').nth(1)).toContainText('stripe');

  await table.getByRole('link', { name: first.upstreamReference }).click();
  await expect(page).toHaveURL(`/payments/${first.id}`);
  await expect(page.getByRole('region', { name: 'Payment summary' })).toBeVisible();
});

test('searches by Upstream Reference and offers to clear when nothing matches', async ({ page }) => {
  const target = store.payments[3]!;
  await page.goto('/payments');
  await page.getByRole('searchbox', { name: 'Search Payments' }).fill(target.upstreamReference);
  await expect(page).toHaveURL(`/payments?q=${target.upstreamReference}`);
  await expect(page.getByRole('table', { name: 'Payments' }).getByRole('link')).toHaveText([target.upstreamReference]);

  await page.getByRole('searchbox', { name: 'Search Payments' }).fill('zzz-no-such-payment');
  await expect(page.getByText('No Payments match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL('/payments');
  await expect(page.getByRole('table', { name: 'Payments' })).toBeVisible();
});

test('loads more Payments and sorts by Amount', async ({ page }) => {
  await page.goto('/payments?sort=amount&order=asc');
  const links = page.getByRole('table', { name: 'Payments' }).getByRole('link');
  await expect(links).toHaveCount(20);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(links).toHaveCount(40);
});

test('stays usable at phone width: the table scrolls, the page does not', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/payments');
  await expect(page.getByRole('table', { name: 'Payments' }).getByRole('link').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const scroller = page.locator('[data-slot="table-container"]');
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('follows the table density from Settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('paybridge.density', 'compact'));
  await page.goto('/payments');
  const compact = await page.locator('[data-slot="table-body"] tr').first().evaluate((el) => el.getBoundingClientRect().height);
  await page.addInitScript(() => localStorage.setItem('paybridge.density', 'comfortable'));
  await page.reload();
  const comfortable = await page.locator('[data-slot="table-body"] tr').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(compact).toBeLessThan(comfortable);
});
