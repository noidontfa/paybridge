import { expect, test } from '@playwright/test';

// The Platform area on mocks only: the real flows are covered by the API's integration tests.

test('suspends and reactivates an Organization', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/platform/organizations');
  const row = page.getByRole('row', { name: 'Acme Retail' });
  await expect(row.getByText('Active')).toBeVisible();
  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(row.getByText('Suspended')).toBeVisible();
  await row.getByRole('button', { name: 'Reactivate' }).click();
  await expect(row.getByText('Active')).toBeVisible();
});

test('lists Super Admins from the Platform nav', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/platform/organizations');
  await page.getByRole('link', { name: 'Super Admins' }).click();
  await expect(page).toHaveURL('/platform/super-admins', { timeout: 30_000 });
  await expect(page.getByRole('row', { name: 'sam@example.test' })).toBeVisible();
});
