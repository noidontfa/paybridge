import { expect, test } from '@playwright/test';
import type { ReviewItem, ReviewSummary } from '@/features/reviews/api';

// Needs the API running and `pnpm db:seed` applied. Expected values are read from the live API,
// so the specs do not depend on the seed's exact numbers. Re-run `pnpm db:seed` to restore the
// Review that the last test resolves.
const HOUR = 3_600_000;

test('Overview loads real figures and follows a recent Payment', async ({ page }) => {
  await page.goto('/?range=30d');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const overview = (await (await page.request.get('/api/bff/internal/overview?range=30d')).json()) as {
    paymentCount: number;
    recentPayments: { id: string }[];
  };
  expect(overview.paymentCount).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: 'Payments' })).toContainText(String(overview.paymentCount));
  await expect(page.locator('.recharts-surface').first()).toBeVisible();

  await page.getByRole('list', { name: 'Recent Payments' }).getByRole('link').first().click();
  await expect(page).toHaveURL(`/payments/${overview.recentPayments[0]!.id}`);
  await expect(page.getByRole('region', { name: 'Payment summary' })).toBeVisible();
});

test('filters Payments by status and gateway', async ({ page }) => {
  const list = (await (
    await page.request.get('/api/bff/internal/payments?status=SUCCEEDED&gatewayId=stripe&limit=100')
  ).json()) as { items: { upstreamReference: string }[] };
  expect(list.items.length).toBeGreaterThan(0);

  await page.goto('/payments');
  const table = page.getByRole('table', { name: 'Payments' });
  await expect(table.getByRole('link').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('SUCCEEDED');
  await page.getByRole('combobox', { name: 'Gateway' }).selectOption('stripe');
  await expect(page).toHaveURL(/status=SUCCEEDED/);
  await expect(table.getByRole('link')).toHaveCount(list.items.length);
  await expect(table.getByRole('link').first()).toHaveText(list.items[0]!.upstreamReference);
});

test('every screen renders the seeded data without an API error', async ({ page }) => {
  const get = async <T>(path: string) => (await (await page.request.get(`/api/bff/internal${path}`)).json()) as T;
  const payment = (await get<{ items: { id: string }[] }>('/payments?limit=1')).items[0]!;
  const callback = (await get<{ items: { id: string }[] }>('/callbacks?limit=1')).items[0]!;
  const event = (await get<{ items: { id: string }[] }>('/payment-events?limit=1')).items[0]!;
  const routes = [
    '/',
    '/payments',
    `/payments/${payment.id}`,
    '/exceptions',
    '/gateways',
    '/gateways/stripe',
    '/gateways/fake',
    '/callbacks',
    `/callbacks/${callback.id}`,
    '/events',
    `/events/${event.id}`,
    '/audit-log',
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first(), route).toBeVisible();
    await expect(page.getByText('did not match the expected shape'), route).toHaveCount(0);
    await expect(page.getByText(/Something went wrong|Could not load/i), route).toHaveCount(0);
  }
});

test('resolves an ambiguous Review to FAILED and the badge and list update', async ({ page }) => {
  const reviews = (await (
    await page.request.get('/api/bff/internal/reviews?reason=AMBIGUOUS_PROVIDER_STATUS&limit=100')
  ).json()) as { items: ReviewItem[] };
  const target = reviews.items.find((r) => Date.parse(r.resolvableAt) < Date.now() - HOUR);
  expect(target, 'no resolvable open Review: run `pnpm db:seed`').toBeDefined();
  const before = (await (await page.request.get('/api/bff/internal/reviews/summary')).json()) as ReviewSummary;
  const note = `Checked with the gateway dashboard (${Date.now()})`;

  await page.goto(`/exceptions/${target!.payment.id}/${target!.id}`);
  await page.getByRole('radio', { name: 'Resolve to FAILED' }).check();
  await page.getByRole('textbox', { name: 'Note' }).fill(note);
  await page.getByRole('button', { name: 'Resolve Review' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm FAILED' }).click();
  await expect(page.getByText('Review resolved')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Status history' })).toContainText(note);

  const after = (await (await page.request.get('/api/bff/internal/reviews/summary')).json()) as ReviewSummary;
  expect(after.open).toBe(before.open - 1);
  await page.goto('/exceptions');
  await expect(page.getByRole('table', { name: 'Exceptions' }).getByText(target!.payment.upstreamReference)).toHaveCount(0);
});
