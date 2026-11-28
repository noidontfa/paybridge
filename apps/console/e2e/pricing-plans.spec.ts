import { expect, test } from '@playwright/test';

// Creates and edits Pricing Plans in the mock store. Each test uses its own
// name, so the seeded Pricing Plans and parallel runs are not disturbed.

test('lists the seeded Pricing Plans, archived ones marked', async ({ page }) => {
  await page.goto('/pricing-plans');
  const table = page.getByRole('table', { name: 'Pricing Plans' });
  await expect(table.getByRole('link', { name: 'Pro', exact: true })).toBeVisible();
  await expect(table.getByRole('row', { name: /Legacy Starter/ }).getByText('Archived')).toBeVisible();
});

test('creates a Pricing Plan and edits it', async ({ page }) => {
  test.setTimeout(60_000);
  const name = `Team ${Date.now()}`;

  await page.goto('/pricing-plans');
  await page.getByRole('link', { name: 'New Pricing Plan' }).click();
  await expect(page).toHaveURL('/pricing-plans/new', { timeout: 30_000 });

  const form = page.getByRole('form', { name: 'Pricing Plan' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Description').fill('For small teams');
  await form.getByLabel('Amount (VND)').fill('149000');
  await form.getByRole('button', { name: 'Add feature' }).click();
  await form.getByLabel('Feature 1', { exact: true }).fill('5 seats');
  await form.getByRole('button', { name: 'Add feature' }).click();
  await form.getByLabel('Feature 2', { exact: true }).fill('Phone support');
  await form.getByLabel('Included: Feature 2', { exact: true }).uncheck();
  await form.getByLabel('Success URL').fill('https://shop.example/thanks');
  await expect(form.getByLabel('Payment Expiry (minutes)')).toHaveValue('30');
  await form.getByRole('button', { name: 'Create Pricing Plan' }).click();

  // The editor reopens on the saved Pricing Plan.
  await expect(page).toHaveURL(/\/pricing-plans\/[^/]+$/, { timeout: 30_000 });
  await expect(page).not.toHaveURL('/pricing-plans/new');
  const saved = page.getByRole('form', { name: 'Pricing Plan' });
  await expect(saved.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(saved.getByLabel('Feature 2', { exact: true })).toHaveValue('Phone support');
  await expect(saved.getByLabel('Included: Feature 2', { exact: true })).not.toBeChecked();

  await saved.getByLabel('Amount (VND)').fill('159000');
  await saved.getByLabel('Payment Expiry (minutes)').fill('90');
  await saved.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status', { name: 'Saved' })).toBeVisible();

  await page.goto('/pricing-plans');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row.getByText('159.000 ₫')).toBeVisible();
  await expect(row.getByText('Active')).toBeVisible();
});

test('shows the API refusal of an invalid Pricing Plan', async ({ page }) => {
  await page.goto('/pricing-plans/new');
  const form = page.getByRole('form', { name: 'Pricing Plan' });
  await form.getByLabel('Name', { exact: true }).fill(`Broken ${Date.now()}`);
  await form.getByLabel('Amount (VND)').fill('0');
  await form.getByRole('button', { name: 'Create Pricing Plan' }).click();
  await expect(form.getByRole('alert')).toContainText('amount');
  await expect(page).toHaveURL('/pricing-plans/new');
});
