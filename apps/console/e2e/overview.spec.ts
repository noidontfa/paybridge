import { expect, test } from '@playwright/test';
import { formatMoney } from '../src/utils/format';
import { computeOverview } from '../src/mocks/overview';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so expected figures come from the same seed the server uses.
const store = createSeededStore();
const week = computeOverview(store, '7d');
const day = computeOverview(store, '24h');

test('loads the Overview, changes the range and follows a recent Payment to its detail page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('radio', { name: 'Last 7 days' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Volume collected' })).toContainText(formatMoney(week.volume));
  await expect(page.getByRole('region', { name: 'Payments' })).toContainText(String(week.paymentCount));
  await expect(page.getByRole('img', { name: /Volume over time/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Payments by status/ })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();

  await page.getByRole('radio', { name: 'Last 24 hours' }).click();
  await expect(page).toHaveURL(/range=24h/);
  await expect(page.getByRole('region', { name: 'Payments' })).toContainText(String(day.paymentCount));
  await expect(page.getByRole('region', { name: 'Volume collected' })).toContainText(formatMoney(day.volume));

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Last 24 hours' })).toBeChecked();

  const first = day.recentPayments[0]!;
  await page.getByRole('list', { name: 'Recent Payments' }).getByRole('link').first().click();
  await expect(page).toHaveURL(`/payments/${first.id}`);
  await expect(page.getByText(first.upstreamReference).first()).toBeVisible();
});
