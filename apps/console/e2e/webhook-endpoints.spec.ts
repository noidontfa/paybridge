import { expect, test } from '@playwright/test';

// Webhook Endpoint management in mock mode. It changes the mock store, so it
// runs in the `mutations` project, one test at a time, on an endpoint of its
// own (the seeded ones belong to webhook-deliveries.spec.ts).
test.describe.configure({ mode: 'serial' });

const ENDPOINT_URL = 'https://hooks.e2e.example/paybridge';
const EDITED = 'https://hooks.e2e.example/paybridge/v2';

test('adds an endpoint and shows its signing secret once', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  const form = page.getByRole('form', { name: 'Add Webhook Endpoint' });
  await form.getByLabel('URL').fill(ENDPOINT_URL);
  await form.getByLabel('payment.created').check();
  await form.getByRole('button', { name: 'Add endpoint' }).click();

  const secret = page.getByRole('status', { name: 'New signing secret' });
  await expect(secret).toContainText('whsec_pb_');
  const row = page.getByRole('row').filter({ hasText: ENDPOINT_URL });
  await expect(row).toContainText('payment.created, payment.succeeded');
  await expect(row.getByText('Enabled')).toBeVisible();
  await secret.getByRole('button', { name: 'Done' }).click();
  await expect(secret).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: ENDPOINT_URL })).toBeVisible();
  await expect(page.getByRole('status', { name: 'New signing secret' })).toHaveCount(0);
});

test('edits the URL and the Payment Events', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  await page.getByRole('button', { name: `Edit ${ENDPOINT_URL}`, exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit Webhook Endpoint' });
  await form.getByLabel('URL').fill(EDITED);
  await form.getByLabel('payment.created').uncheck();
  await form.getByLabel('payment.expired').check();
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(form).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: EDITED });
  await expect(row).toContainText('payment.succeeded, payment.expired');
});

test('refuses an invalid URL and says why', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  const form = page.getByRole('form', { name: 'Add Webhook Endpoint' });
  await form.getByLabel('URL').fill('not a url');
  await form.getByRole('button', { name: 'Add endpoint' }).click();

  await expect(form.getByRole('alert')).toHaveText('The URL is not valid');
});

test('rolls the signing secret with an overlap', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  const row = page.getByRole('row').filter({ hasText: EDITED });
  const before = await row.locator('td').nth(2).textContent();
  await page.getByRole('button', { name: `Roll secret ${EDITED}` }).click();
  const form = page.getByRole('form', { name: 'Roll signing secret' });
  await form.getByLabel('Keep the old secret valid for').selectOption('1h');
  await form.getByRole('button', { name: 'Roll secret' }).click();

  await expect(page.getByRole('status', { name: 'New signing secret' })).toContainText('whsec_pb_');
  await expect(row).toContainText('Previous secret valid until');
  await expect(row.locator('td').nth(2)).not.toHaveText(before ?? '');
});

test('disables and enables the endpoint, then deletes it', async ({ page }) => {
  await page.goto('/settings/webhook-endpoints');
  const row = page.getByRole('row').filter({ hasText: EDITED });

  await page.getByRole('button', { name: `Disable ${EDITED}` }).click();
  await expect(row.getByText('Disabled')).toBeVisible();
  await page.getByRole('button', { name: `Enable ${EDITED}` }).click();
  await expect(row.getByText('Enabled')).toBeVisible();

  await page.getByRole('button', { name: `Delete ${EDITED}` }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: EDITED })).toHaveCount(0);
});
