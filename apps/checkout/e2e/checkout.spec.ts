import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API_URL, DISALLOWED_HOST, SEED } from './env.js';

// The Customer's experience, on a plain HTML host page embedding the snippet,
// against the real API with its seed data: the "Home page pricing" table
// (Vietnamese, light, #4f46e5, "Mua ngay") with Basic, Pro (recommended) and
// the archived Legacy Starter. Basic allows every enabled gateway, among them
// the fake QR gateway.

interface Outcome {
  via: 'callback' | 'event';
  outcome: 'success' | 'cancel' | 'error';
  detail: { paymentId: string | null; reason?: string };
}

const card = (page: Page, planId: string) => page.locator(`[data-plan-id="${planId}"]`);
const checkoutFrame = (page: Page) => page.frameLocator('[data-paybridge-modal] iframe');
const closeModal = (page: Page) => page.locator('[data-paybridge-modal] .pb-close').click();
const outcomes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __outcomes: Outcome[] }).__outcomes);

async function buyBasicByQr(page: Page): Promise<string> {
  await card(page, SEED.plans.basic).getByRole('button', { name: 'Mua ngay' }).click();
  const frame = checkoutFrame(page);
  await expect(frame.getByTestId('plan-name')).toHaveText('Basic');
  await frame.getByRole('button', { name: 'Fake QR' }).click();
  const qr = frame.locator('[data-qr-payload]');
  await expect(qr.locator('svg')).toBeVisible();
  return (await qr.getAttribute('data-qr-payload'))!;
}

/** Pays a fake-qr attempt as the gateway would: a signed callback. */
async function payByQr(payload: string, amount: string): Promise<void> {
  const attemptKey = payload.replace('fake-qr://pay/', '');
  const body = JSON.stringify({ attemptKey, status: 'SUCCEEDED', amount });
  const signature = createHmac('sha256', SEED.fakeSecret).update(body).digest('hex');
  const res = await fetch(`${API_URL}/api/webhooks/fake-qr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    body,
  });
  expect(res.ok).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('draws the Pricing Table as cards with its theme, untouched by host styles', async ({ page }) => {
  const basic = card(page, SEED.plans.basic);
  const pro = card(page, SEED.plans.pro);
  await expect(basic.getByRole('heading', { name: 'Basic' })).toBeVisible();
  await expect(basic).toContainText('99.000');
  await expect(basic.getByRole('img', { name: 'Có', exact: true })).toHaveCount(2);
  await expect(basic.getByRole('img', { name: 'Không có', exact: true })).toHaveCount(1);
  await expect(basic).toContainText('Priority support');
  await expect(pro).toContainText('Khuyên dùng');
  await expect(basic).not.toContainText('Khuyên dùng');

  const button = basic.getByRole('button', { name: 'Mua ngay' });
  await expect(button).toHaveCSS('background-color', 'rgb(79, 70, 229)');
  await expect(basic.getByRole('heading', { name: 'Basic' })).not.toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(button).not.toHaveCSS('font-size', '40px');
});

test('shows an archived Pricing Plan as unavailable, with the reason only in the console', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  await page.reload();

  const legacy = card(page, SEED.plans.legacy);
  await expect(legacy).toContainText('Hiện chưa thể thanh toán');
  await expect(legacy.getByRole('button', { name: 'Mua ngay' })).toBeDisabled();
  await expect(legacy).not.toContainText('ARCHIVED');
  expect(messages.some((m) => m.includes('PRICING_PLAN_ARCHIVED'))).toBe(true);
});

test('buys a Pricing Plan by QR with the fake gateway and calls onSuccess', async ({ page }) => {
  const payload = await buyBasicByQr(page);
  const frame = checkoutFrame(page);
  await expect(frame.getByTestId('amount')).toContainText('99.000');

  await payByQr(payload, '99000');

  await expect(frame.getByText('Thanh toán thành công')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => outcomes(page)).toHaveLength(2);
  const [first, second] = await outcomes(page);
  expect(new Set([first!.via, second!.via])).toEqual(new Set(['callback', 'event']));
  expect(first!.outcome).toBe('success');
  expect(second!.outcome).toBe('success');
  expect(first!.detail.paymentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(second!.detail.paymentId).toBe(first!.detail.paymentId);

  // Closing after success is not a cancel.
  await frame.getByRole('button', { name: 'Xong' }).click();
  await expect(page.locator('[data-paybridge-modal]')).toHaveCount(0);
  expect(await outcomes(page)).toHaveLength(2);
});

test('calls onCancel with the Payment when the Customer closes the checkout', async ({ page }) => {
  await buyBasicByQr(page);

  await closeModal(page);

  await expect(page.locator('[data-paybridge-modal]')).toHaveCount(0);
  const cancels = (await outcomes(page)).filter((o) => o.outcome === 'cancel');
  expect(cancels.map((o) => o.via).sort()).toEqual(['callback', 'event']);
  expect(cancels[0]!.detail.paymentId).toMatch(/^[0-9a-f-]{36}$/);
});

test('resumes the same open Payment when the checkout is reopened', async ({ page }) => {
  const payload = await buyBasicByQr(page);
  await closeModal(page);

  await card(page, SEED.plans.basic).getByRole('button', { name: 'Mua ngay' }).click();

  const qr = checkoutFrame(page).locator('[data-qr-payload]');
  await expect(qr).toHaveAttribute('data-qr-payload', payload);
  await closeModal(page);
  const paymentIds = (await outcomes(page))
    .filter((o) => o.via === 'callback')
    .map((o) => o.detail.paymentId);
  expect(paymentIds).toHaveLength(2);
  expect(paymentIds[1]).toBe(paymentIds[0]);
});

test('lets the Customer switch PaymentGateway after abandoning an attempt', async ({ page }) => {
  await page.route('https://fake-gateway.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fake gateway</title>' }),
  );
  const first = await buyBasicByQr(page);
  let frame = checkoutFrame(page);

  // Off to the redirect gateway's page, then straight back with the browser.
  await frame.getByTestId('switch-gateway').click();
  await frame.getByRole('button', { name: 'Fake gateway' }).click();
  await page.waitForURL(/^https:\/\/fake-gateway\.test\//);
  await page.goBack();
  await card(page, SEED.plans.basic).getByRole('button', { name: 'Mua ngay' }).click();
  frame = checkoutFrame(page);

  // The resumed redirect attempt waits for the Customer instead of leaving again.
  await expect(frame.getByRole('link', { name: 'Tiếp tục đến trang thanh toán' })).toBeVisible();
  await frame.getByTestId('switch-gateway').click();
  await frame.getByRole('button', { name: 'Fake QR' }).click();

  const qr = frame.locator('[data-qr-payload]');
  await expect(qr.locator('svg')).toBeVisible();
  const second = await qr.getAttribute('data-qr-payload');
  expect(second).not.toBe(first);
  await payByQr(second!, '99000');
  await expect(frame.getByText('Thanh toán thành công')).toBeVisible({ timeout: 20_000 });
});

for (const [name, query, reason] of [
  ['a deleted Pricing Table', `table=${randomUUID()}`, 'PRICING_TABLE_NOT_FOUND'],
  ['an unknown or revoked key', 'key=pb_pk_revoked_00000000000000000000000000', 'INVALID_PUBLISHABLE_KEY'],
] as const) {
  test(`shows "not available" for ${name}, with the reason only in the console`, async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (m) => messages.push(m.text()));

    await page.goto(`/?lang=vi&${query}`);

    await expect(page.locator('[data-paybridge-pricing-table]')).toContainText(
      'Hiện chưa thể thanh toán',
    );
    await expect(page.locator('[data-paybridge-pricing-table]')).not.toContainText(reason);
    await expect.poll(() => messages.some((m) => m.includes(reason))).toBe(true);
    await expect.poll(async () => (await outcomes(page)).map((o) => o.detail.reason)).toEqual([
      reason,
      reason,
    ]);
  });
}

test('refuses a host page on an origin the key does not allow', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));

  await page.goto(`${DISALLOWED_HOST}/`);

  await expect(page.locator('[data-paybridge-pricing-table]')).toContainText(
    'Payment is not available right now',
  );
  await expect(page.locator('[data-plan-id]')).toHaveCount(0);
  await expect.poll(() => messages.some((m) => m.includes('ORIGIN_NOT_ALLOWED'))).toBe(true);
});

test.describe('the checkout page in a frame', () => {
  const frameLoaded = (page: Page) =>
    page.frameLocator('#checkout').locator('#app').count();

  test('loads on an allowed origin', async ({ page }) => {
    await page.goto('/raw-iframe');

    await expect.poll(() => frameLoaded(page)).toBe(1);
  });

  for (const [name, hostOrigin] of [
    ['naming itself', undefined],
    ['claiming to be an allowed origin', 'http://localhost:5173'],
  ] as const) {
    test(`refuses to load on a disallowed origin ${name}`, async ({ page }) => {
      const query = hostOrigin ? `?hostOrigin=${encodeURIComponent(hostOrigin)}` : '';
      const checkoutResponse = page.waitForResponse((r) => r.url().includes('/checkout?'));

      await page.goto(`${DISALLOWED_HOST}/raw-iframe${query}`);
      await checkoutResponse;

      await expect
        .poll(() => page.frames().some((f) => f.url().startsWith('chrome-error://')))
        .toBe(true);
      expect(await frameLoaded(page)).toBe(0);
    });
  }
});
