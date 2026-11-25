import { expect, test } from '@playwright/test';
import type { ReviewItem, ReviewSummary } from '../src/lib/api/reviews';

// This spec changes the mock store, so it runs in its own project, after every other spec (see the config).
// It picks its Review from the live mock API, so it also works when the dev server is reused.
const HOUR = 3_600_000;

test('resolves an ambiguous Review to FAILED with a note and sees the badge, list and Payment detail update', async ({ page }) => {
  const reviews = (await (await page.request.get('/api/bff/internal/reviews?reason=AMBIGUOUS_PROVIDER_STATUS&limit=100')).json()) as {
    items: ReviewItem[];
  };
  const target = reviews.items.find((r) => r.payment.status === 'PENDING' && Date.parse(r.resolvableAt) < Date.now() - HOUR)!;
  expect(target).toBeDefined();
  const before = (await (await page.request.get('/api/bff/internal/reviews/summary')).json()) as ReviewSummary;
  const note = `Checked with the gateway dashboard (${Date.now()})`;

  await page.goto('/exceptions');
  const table = page.getByRole('table', { name: 'Exceptions' });
  await expect(page.getByLabel(`${before.open} open ${before.open === 1 ? 'Review' : 'Reviews'}`)).toBeVisible();
  // The sidebar footer shows who resolutions are recorded as.
  await expect(page.getByRole('button', { name: 'Operator menu' })).toContainText('operator');

  await page.goto(`/exceptions?payment=${target.payment.id}&transaction=${target.id}`);
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('radio', { name: 'Resolve to FAILED' }).check();
  // A note is mandatory.
  await sheet.getByRole('button', { name: 'Resolve Review' }).click();
  await expect(sheet.getByText('Enter a note explaining the decision.')).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Note' }).fill(note);
  await sheet.getByRole('button', { name: 'Resolve Review' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm FAILED' }).click();

  await expect(page.getByText('Review resolved')).toBeVisible();
  await expect(sheet.getByRole('form', { name: 'Resolve Review' })).toBeHidden();
  await expect(sheet.getByRole('table', { name: 'Status history' })).toContainText(note);

  // The badge and the list no longer count it.
  const remaining = before.open - 1;
  if (remaining > 0) {
    await expect(page.getByLabel(`${remaining} open ${remaining === 1 ? 'Review' : 'Reviews'}`)).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(table.getByText(target.payment.upstreamReference)).toHaveCount(0);
  await page.getByRole('button', { name: 'Closed' }).click();
  await expect(table.getByText(target.payment.upstreamReference)).toBeVisible();

  // The Payment detail shows the resolution with its actor and note.
  await page.goto(`/payments/${target.payment.id}`);
  const history = page.getByRole('table', { name: 'Status history' }).filter({ hasText: note });
  await expect(history).toContainText('operator_resolution');
  await expect(history).toContainText('operator');
  await expect(page.getByRole('group', { name: 'Review' }).getByRole('form')).toHaveCount(0);
});
