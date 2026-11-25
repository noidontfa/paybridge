import { expect, test } from '@playwright/test';
import { gatewayDetail } from '../src/mocks/gateways';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so the expected figures come from the same seed the server uses.
const store = createSeededStore();
const stripe = gatewayDetail(store, store.gateways.find((g) => g.id === 'stripe')!);

test('lists stripe and fake with their state and Callback URL', async ({ page }) => {
  await page.goto('/gateways');
  for (const id of ['stripe', 'fake']) {
    const card = page.getByRole('article', { name: id });
    await expect(card).toBeVisible();
    await expect(card.getByText('Registered')).toBeVisible();
    await expect(card.getByText(`/webhooks/${id}`)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Copy Callback URL' })).toBeVisible();
  }
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('opens a gateway, shows its health and follows the filtered links', async ({ page }) => {
  // The dev server compiles each route on first visit; under parallel load that can be slow.
  test.setTimeout(60_000);
  await page.goto('/gateways');
  await page.getByRole('link', { name: 'stripe' }).click();
  await expect(page).toHaveURL('/gateways/stripe');

  const counts = page.getByRole('region', { name: 'Callbacks in the last 24 hours' });
  await expect(counts.getByText(String(stripe.callbackCounts.FAILED), { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Last Callback' }).locator('time')).toHaveAttribute('datetime', stripe.lastCallbackAt!);

  await page.getByRole('link', { name: 'View Callbacks' }).click();
  await expect(page).toHaveURL(/\/callbacks\?gatewayId=stripe$/, { timeout: 30_000 });
  await expect(page.getByRole('combobox', { name: 'Gateway' })).toHaveValue('stripe');

  await page.goto('/gateways/stripe');
  await page.getByRole('link', { name: 'View Payments' }).click();
  await expect(page).toHaveURL(/\/payments\?gatewayId=stripe$/, { timeout: 30_000 });
  await expect(page.getByRole('combobox', { name: 'Gateway' })).toHaveValue('stripe');
});

test('shows a not-found state for an unknown gateway', async ({ page }) => {
  await page.goto('/gateways/vnpay');
  await expect(page.getByText('Gateway not found')).toBeVisible();
});
