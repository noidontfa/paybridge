import { expect, test } from '@playwright/test';

test('opens the Console, navigates through the sidebar and switches theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('PayBridge Console').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  const sidebar = page.locator('[data-sidebar="sidebar"]');
  await sidebar.getByRole('link', { name: 'Payments', exact: true }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toBeVisible();

  await sidebar.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/audit-log$/);

  await sidebar.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByText('http://api.test:3000')).toBeVisible();

  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('switches theme from the Operator menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Operator menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('works as a drawer on a phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/payments');
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Gateways' })).toBeVisible();
});

test('sidebar is operable by keyboard and Refunds is not a link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Refunds' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Gateways' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/gateways$/);
});
