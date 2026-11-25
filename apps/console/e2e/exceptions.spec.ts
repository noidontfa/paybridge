import { expect, test } from '@playwright/test';
import { queryReviews, summarizeReviews } from '../src/mocks/reviews';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so the expected figures come from the same seed the server uses.
const store = createSeededStore();
const summary = summarizeReviews(store);
const open = queryReviews(store, new URLSearchParams('limit=100')).items;
const mismatch = queryReviews(store, new URLSearchParams('reason=AMOUNT_MISMATCH&limit=100')).items;

test('shows the open Review count on the sidebar and lists Reviews, oldest first', async ({ page }) => {
  expect(summary.open).toBeGreaterThan(0);
  await page.goto('/exceptions');

  await expect(page.getByLabel(`${summary.open} open ${summary.open === 1 ? 'Review' : 'Reviews'}`)).toBeVisible();
  const table = page.getByRole('table', { name: 'Exceptions' });
  await expect(table.getByRole('row')).toHaveCount(Math.min(open.length, 20) + 1);
  await expect(table.getByRole('row').nth(1)).toContainText(open[0]!.payment.upstreamReference);
});

test('filters by reason, opens a Review sheet that survives a reload, and closes it with Escape', async ({ page }) => {
  const first = mismatch[0]!;
  await page.goto('/exceptions');
  const table = page.getByRole('table', { name: 'Exceptions' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();

  await page.getByRole('combobox', { name: 'Review reason' }).selectOption('AMOUNT_MISMATCH');
  await expect(page).toHaveURL(/reason=AMOUNT_MISMATCH/);
  await expect(table.getByRole('row')).toHaveCount(mismatch.length + 1);

  await table.getByRole('button', { name: `Review ${first.payment.upstreamReference}` }).click();
  await expect(page).toHaveURL(new RegExp(`transaction=${first.id}`));
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('region', { name: 'Payment summary' })).toBeVisible();
  await expect(sheet.getByRole('group', { name: 'Review' })).toContainText('Amount mismatch');
  await expect(sheet.getByRole('table', { name: 'Status history' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Review' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).not.toHaveURL(/transaction=/);
  await expect(page).toHaveURL(/reason=AMOUNT_MISMATCH/);
});

test('switches to closed Reviews', async ({ page }) => {
  await page.goto('/exceptions');
  await page.getByRole('button', { name: 'Closed' }).click();
  await expect(page).toHaveURL(/state=closed/);
  const closed = queryReviews(store, new URLSearchParams('state=closed&limit=100')).items;
  expect(closed.length).toBeGreaterThan(0);
  await expect(page.getByRole('table', { name: 'Exceptions' }).getByRole('row')).toHaveCount(closed.length + 1);
});
