import { expect, test } from '@playwright/test';
import { queryCallbacks } from '../src/mocks/callbacks';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so the expected rows come from the same seed the server uses.
const store = createSeededStore();
const failedFake = queryCallbacks(store, new URLSearchParams('status=FAILED&gatewayId=fake&limit=100'));
const known = store.callbacks.find((c) => c.attemptKey && store.attempts.some((a) => a.id === c.attemptKey) && c.rawBody.startsWith('{'))!;
const unknownKey = store.callbacks.find((c) => c.attemptKey && !store.attempts.some((a) => a.id === c.attemptKey))!;

test('filters Callbacks by gateway and status, keeps the view across a reload, and opens one', async ({ page }) => {
  expect(failedFake.items.length).toBeGreaterThan(0);
  await page.goto('/callbacks');
  const table = page.getByRole('table', { name: 'Callbacks' });
  await expect(table.getByRole('link').first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Gateway' }).selectOption('fake');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('FAILED');
  await expect(page).toHaveURL(/gatewayId=fake/);
  await expect(page).toHaveURL(/status=FAILED/);
  await expect(table.getByRole('row')).toHaveCount(failedFake.items.length + 1);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('FAILED');
  await expect(table.getByRole('row')).toHaveCount(failedFake.items.length + 1);

  await table.getByRole('link').first().click();
  await expect(page).toHaveURL(`/callbacks/${failedFake.items[0]!.id}`);
  await expect(page.getByRole('region', { name: 'Last error' })).toBeVisible();
});

test('shows a JSON body pretty-printed and links to the Payment', async ({ page }) => {
  await page.goto(`/callbacks/${known.id}`);
  const body = page.getByRole('region', { name: 'Raw body' });
  await expect(body.locator('pre')).toContainText('\n  "');
  await page.getByRole('link', { name: 'View Payment' }).click();
  await expect(page).toHaveURL(/\/payments\//);
});

test('shows no Payment link for an unknown Attempt Key', async ({ page }) => {
  await page.goto(`/callbacks/${unknownKey.id}`);
  await expect(page.getByRole('region', { name: 'Raw body' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Payment' })).toHaveCount(0);
  await expect(page.getByText(/matches no PaymentTransaction/)).toBeVisible();
});

test('shows a not-found state', async ({ page }) => {
  await page.goto('/callbacks/does-not-exist');
  await expect(page.getByText('Callback not found')).toBeVisible();
});
