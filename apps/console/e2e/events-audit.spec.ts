import { expect, test } from '@playwright/test';
import { queryPaymentEvents, queryStatusTransitions } from '../src/mocks/events-audit';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so the expected rows come from the same seed the server uses.
const store = createSeededStore();

test('filters Payment Events to the unpublished ones, then opens one and sees its payload', async ({ page }) => {
  const stuck = queryPaymentEvents(store, new URLSearchParams('published=false&limit=100'));
  expect(stuck.items.length).toBeGreaterThan(1);
  const first = stuck.items[0]!;
  const payload = store.events.find((e) => e.id === first.id)!.payload;

  await page.goto('/events');
  const table = page.getByRole('table', { name: 'Payment Events' });
  await expect(table.getByRole('row')).not.toHaveCount(1);

  await page.getByRole('combobox', { name: 'Published' }).selectOption('false');
  await expect(page).toHaveURL(/published=false/);
  await expect(table.getByRole('row').nth(1)).toContainText('Unpublished');
  await expect(table.getByText('Unpublished')).toHaveCount(Math.min(20, stuck.items.length));

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Published' })).toHaveValue('false');

  await table.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(`/events/${first.id}`);
  const region = page.getByRole('region', { name: 'Payload' });
  await expect(region.locator('pre')).toHaveText(JSON.stringify(payload, null, 2));
  await expect(page.getByRole('link', { name: first.paymentId })).toHaveAttribute('href', `/payments/${first.paymentId}`);
});

test('filters the Audit log to operator resolutions and follows a row to its Payment', async ({ page }) => {
  const resolutions = queryStatusTransitions(store, new URLSearchParams('trigger=operator_resolution&limit=100'));
  expect(resolutions.items.length).toBeGreaterThan(0);
  const first = resolutions.items[0]!;

  await page.goto('/audit-log');
  const table = page.getByRole('table', { name: 'Audit log' });
  await expect(table.getByRole('row')).not.toHaveCount(1);

  await page.getByRole('combobox', { name: 'Trigger' }).selectOption('operator_resolution');
  await expect(page).toHaveURL(/trigger=operator_resolution/);
  await expect(table.getByRole('row').nth(1)).toContainText('operator_resolution');
  await expect(table.getByRole('row').nth(1)).toContainText(first.reason!);

  await table.getByRole('row').nth(1).getByRole('link', { name: first.paymentId! }).click();
  await expect(page).toHaveURL(`/payments/${first.paymentId}`);
  await expect(page.getByRole('region', { name: 'Payment summary' })).toBeVisible();
});

test('shows a not-found state for an unknown Payment Event', async ({ page }) => {
  await page.goto('/events/no-such-event');
  await expect(page.getByText('Payment Event not found')).toBeVisible();
});
