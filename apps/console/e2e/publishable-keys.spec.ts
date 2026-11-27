import { expect, test } from '@playwright/test';

// Publishable Key management in mock mode. It changes the mock store, so it
// runs in the `mutations` project, one test at a time, on a key of its own
// (pricing-tables.spec.ts picks the seeded keys for its snippet).
test.describe.configure({ mode: 'serial' });

const LABEL = 'E2E landing page';

test('creates a key for the allowed websites; the key stays visible', async ({ page }) => {
  await page.goto('/settings/publishable-keys');
  const form = page.getByRole('form', { name: 'Create Publishable Key' });
  await form.getByLabel('Label').fill(LABEL);
  await form.getByLabel('Allowed origins').fill('https://shop.e2e.example\nhttps://www.e2e.example/');
  await form.getByRole('button', { name: 'Create Publishable Key' }).click();

  const row = page.getByRole('row').filter({ hasText: LABEL });
  await expect(row.getByRole('code')).toContainText('pb_pk_');
  await expect(row.getByRole('listitem')).toHaveText(['https://shop.e2e.example', 'https://www.e2e.example']);
  await expect(row).toContainText('Active');
  await expect(form.getByLabel('Label')).toHaveValue('');

  // A Publishable Key is public: it is shown again after a reload.
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: LABEL }).getByRole('code')).toContainText('pb_pk_');
});

test('refuses an allowed origin that is not an origin', async ({ page }) => {
  await page.goto('/settings/publishable-keys');
  const form = page.getByRole('form', { name: 'Create Publishable Key' });
  await form.getByLabel('Label').fill('Bad origins');
  await form.getByLabel('Allowed origins').fill('https://shop.e2e.example/pricing');
  await form.getByRole('button', { name: 'Create Publishable Key' }).click();

  await expect(form.getByRole('alert')).toContainText('is not an origin');
  await expect(page.getByRole('row').filter({ hasText: 'Bad origins' })).toHaveCount(0);
});

test('edits the allowed origins', async ({ page }) => {
  await page.goto('/settings/publishable-keys');
  await page.getByRole('button', { name: `Edit origins of ${LABEL}` }).click();
  await page.getByLabel(`Allowed origins of ${LABEL}`).fill('https://checkout.e2e.example');
  await page.getByRole('button', { name: 'Save origins' }).click();

  const row = page.getByRole('row').filter({ hasText: LABEL });
  await expect(row.getByRole('listitem')).toHaveText(['https://checkout.e2e.example']);
});

test('revokes the key', async ({ page }) => {
  await page.goto('/settings/publishable-keys');
  const row = page.getByRole('row').filter({ hasText: LABEL });
  await page.getByRole('button', { name: `Revoke ${LABEL}` }).click();

  await expect(row).toContainText('Revoked');
  await expect(row.getByRole('button')).toHaveCount(1); // only the copy button is left
});
