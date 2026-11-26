import { expect, test } from '@playwright/test';
import { createSeededStore } from '../src/mocks/seed';
import { queryWebhookDeliveries, SEED_ENDPOINTS } from '../src/mocks/webhook-deliveries';

// The mock store is deterministic, so the expected rows come from the same seed the server uses.
// Resending changes the store, so this spec runs in the `mutations` project, one test at a time.
test.describe.configure({ mode: 'serial' });

const store = createSeededStore();
const kind = queryWebhookDeliveries(store, new URLSearchParams(`endpointId=${SEED_ENDPOINTS.erp}`)).items[0]!.eventKind;
const erpOfKind = queryWebhookDeliveries(store, new URLSearchParams(`endpointId=${SEED_ENDPOINTS.erp}&kind=${kind}&limit=100`));
const failed = queryWebhookDeliveries(store, new URLSearchParams(`endpointId=${SEED_ENDPOINTS.crm}&status=FAILED&limit=100`));
const toResend = failed.items.at(-1)!;
const withPayment = erpOfKind.items[0]!;

test('filters deliveries by endpoint, status and event, and keeps the view across a reload', async ({ page }) => {
  expect(erpOfKind.items.length).toBeGreaterThan(0);
  await page.goto('/webhooks/deliveries');
  const table = page.getByRole('table', { name: 'Webhook deliveries' });
  await expect(table.getByRole('link').first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Webhook Endpoint' }).selectOption(SEED_ENDPOINTS.erp);
  await page.getByRole('combobox', { name: 'Event' }).selectOption(kind);
  await expect(page).toHaveURL(new RegExp(`kind=${kind}`));
  await expect(table.getByRole('row')).toHaveCount(erpOfKind.items.length + 1);
  await expect(table.getByText('Delivered').first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Event' })).toHaveValue(kind);
  await expect(table.getByRole('row')).toHaveCount(erpOfKind.items.length + 1);

  await page.getByRole('combobox', { name: 'Status' }).selectOption('FAILED');
  await expect(page.getByText('No deliveries match these filters')).toBeVisible();
});

test("shows a Payment's deliveries on its detail page", async ({ page }) => {
  await page.goto(`/payments/${withPayment.paymentId}`);
  const section = page.getByRole('region', { name: 'Webhook deliveries' });
  await expect(section.getByRole('link', { name: withPayment.eventKind }).first()).toBeVisible();
  await section.getByRole('link', { name: withPayment.eventKind }).first().click();
  await expect(page).toHaveURL(/\/webhooks\/deliveries\//);
  await expect(page.getByRole('region', { name: 'Attempts' })).toBeVisible();
});

test('marks a failing endpoint, and a resend delivers the event and clears the mark', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  const crm = page.getByRole('row').filter({ hasText: 'crm.example.test' });
  await expect(crm.getByText('Failing')).toBeVisible();
  const erp = page.getByRole('row').filter({ hasText: 'erp.example.test' });
  await expect(erp.getByText('Failing')).toHaveCount(0);

  await page.goto(`/webhooks/deliveries/${toResend.id}`);
  const attempts = page.getByRole('region', { name: 'Attempts' });
  await expect(attempts.getByRole('listitem')).toHaveCount(1);
  await expect(attempts.getByRole('listitem').first()).toContainText('database unavailable');
  await page.getByRole('button', { name: 'Resend' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Resent: the endpoint accepted it.' })).toBeVisible();
  await expect(attempts.getByRole('listitem')).toHaveCount(2);
  await expect(attempts.getByRole('listitem').first()).toContainText('Mock Operator');
  await expect(page.getByRole('region', { name: 'Delivery summary' }).getByText('Delivered')).toBeVisible();

  await page.goto('/settings/webhook-endpoints');
  await expect(page.getByRole('row').filter({ hasText: 'crm.example.test' }).getByText('Failing')).toHaveCount(0);
});

test('sends a test event to an endpoint and shows the result', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  await page.getByRole('button', { name: 'Send a test event to https://erp.example.test/paybridge/webhooks' }).click();
  await expect(page.getByRole('status', { name: 'Test result for https://erp.example.test/paybridge/webhooks' })).toHaveText(
    'Test delivered (HTTP 200)',
  );
  await page.goto('/webhooks/deliveries?kind=webhook.test');
  await expect(page.getByRole('table', { name: 'Webhook deliveries' }).getByRole('row')).toHaveCount(2);
});
