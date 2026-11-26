import { expect, test } from '@playwright/test';

// Builds a Pricing Table in the mock store and copies its snippet. Each test
// uses its own names, so the seeded data and parallel runs are not disturbed.

test('lists the seeded Pricing Table with its recommended Pricing Plan', async ({ page }) => {
  await page.goto('/pricing-tables');
  const row = page.getByRole('table', { name: 'Pricing Tables' }).getByRole('row', { name: /Home page pricing/ });
  await expect(row.getByText(/Pro \(recommended\)/)).toBeVisible();
});

test('builds a Pricing Table, previews it and copies its snippet', async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const suffix = Date.now().toString(36);
  const key = await page.request.post('/api/bff/internal/publishable-keys', {
    data: { label: `Website ${suffix}`, allowedOrigins: ['https://shop.example'] },
  });
  expect(key.ok()).toBe(true);
  const { key: publishableKey } = (await key.json()) as { key: string };

  await page.goto('/pricing-tables');
  await page.getByRole('link', { name: 'New Pricing Table' }).click();
  await expect(page).toHaveURL('/pricing-tables/new', { timeout: 30_000 });

  const name = `Promotion ${suffix}`;
  const form = page.getByRole('form', { name: 'Pricing Table' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByRole('checkbox', { name: /^Pro/ }).check();
  await form.getByRole('checkbox', { name: /^Basic/ }).check();
  await form.getByRole('button', { name: 'Move Basic left' }).click();
  await form.getByLabel('Recommended').selectOption({ label: 'Pro' });
  await form.getByLabel('Main colour').fill('#16a34a');
  await form.getByLabel('Theme').selectOption('dark');
  await form.getByLabel('Language').selectOption('en');
  await form.getByLabel('Button text').fill('Buy now');

  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByRole('listitem', { name: 'Basic' })).toBeVisible();
  await expect(preview.getByRole('listitem', { name: 'Pro' }).getByText('Recommended')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Buy now' })).toHaveCount(2);

  await form.getByRole('button', { name: 'Create Pricing Table' }).click();

  // The editor reopens on the saved Pricing Table, with its snippet.
  await expect(page).toHaveURL(/\/pricing-tables\/[^/]+$/, { timeout: 30_000 });
  await expect(page).not.toHaveURL('/pricing-tables/new');
  const tableId = decodeURIComponent(page.url().split('/').pop()!);
  const saved = page.getByRole('form', { name: 'Pricing Table' });
  await expect(saved.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(page.getByRole('list', { name: 'Card order' }).getByRole('listitem')).toHaveText([/Basic/, /Pro/]);

  const embed = page.getByRole('region', { name: 'Embed' });
  await embed.getByLabel('Publishable Key').selectOption({ label: `Website ${suffix} (https://shop.example)` });
  const snippet = embed.getByLabel('Snippet', { exact: true });
  await expect(snippet).toContainText(`data-key="${publishableKey}"`);
  await expect(snippet).toContainText(`data-table="${tableId}"`);
  await expect(embed.getByText('data-success-url')).toBeVisible();

  await embed.getByRole('button', { name: 'Copy snippet' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('/v1/paybridge.js');
  expect(copied).toContain(`data-key="${publishableKey}"`);
  expect(copied).toContain(`data-table="${tableId}"`);
});

test('shows the API refusal of a Pricing Table without Pricing Plans', async ({ page }) => {
  await page.goto('/pricing-tables/new');
  const form = page.getByRole('form', { name: 'Pricing Table' });
  await form.getByLabel('Name', { exact: true }).fill(`Empty ${Date.now()}`);
  await form.getByRole('button', { name: 'Create Pricing Table' }).click();
  await expect(form.getByRole('alert')).toContainText('planIds');
  await expect(page).toHaveURL('/pricing-tables/new');
});
