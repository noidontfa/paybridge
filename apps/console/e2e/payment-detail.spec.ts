import { expect, test } from '@playwright/test';
import { createSeededStore } from '../src/mocks/seed';

// The mock store is deterministic, so the test can pick its Payments from the same seed the server uses.
const store = createSeededStore();
const switched = store.payments.find(
  (p) => p.status === 'SUCCEEDED' && new Set(store.attemptsOf(p.id).map((a) => a.gatewayId)).size > 1,
)!;
const inReview = store.payments.find((p) =>
  store.attemptsOf(p.id).some((a) => a.reviewReason === 'AMBIGUOUS_PROVIDER_STATUS'),
)!;

test('shows the mock banner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Mock mode' })).toBeVisible();
});

test('opens a Payment with a gateway switch and shows its timeline', async ({ page }) => {
  await page.goto(`/payments/${switched.id}`);
  await expect(page.getByText(switched.upstreamReference)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Payment summary' })).toBeVisible();
  const items = page
    .getByRole('list', { name: 'PaymentTransactions' })
    .getByRole('listitem', { name: /PaymentTransaction \d/ });
  await expect(items).toHaveCount(store.attemptsOf(switched.id).length);
  await expect(page.getByText(/Switched from/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Payment Events' })).toContainText('PaymentCreated');
  await expect(page.getByRole('button', { name: /cancel/i })).toHaveCount(0);
});

test('shows how long a Review has been open', async ({ page }) => {
  await page.goto(`/payments/${inReview.id}`);
  const review = page.getByRole('group', { name: 'Review' });
  await expect(review).toContainText('Ambiguous status');
  await expect(review).toContainText(/Opened .* ago/);
});

test('shows a not-found state for an unknown id', async ({ page }) => {
  await page.goto('/payments/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Payment not found' })).toBeVisible();
});

test('the BFF serves the API path and answers the API error shape for an unknown id', async ({ request }) => {
  const ok = await request.get(`/api/bff/internal/payments/${switched.id}`);
  expect(ok.status()).toBe(200);
  expect((await ok.json()).upstreamReference).toBe(switched.upstreamReference);

  const missing = await request.get('/api/bff/internal/payments/nope');
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
});
