import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ALLOWED_HOST, API_URL, CHECKOUT_URL, SEED } from './env.js';

// Ticket 10: paying with a gateway that leaves the site. The fake gateway's
// NextAction is a redirect to https://fake-gateway.test/pay/<attemptKey>,
// which does not exist: the test stubs that page, pays (or gives up) as the
// gateway would with a signed callback, and then sends the browser to the
// return URL the checkout gave the gateway, as a gateway does.
//
// Seed: Basic has no return URLs; Pro has https://shop.example/thanks and
// https://shop.example/pricing.

const GATEWAY_PAGE = /^https:\/\/fake-gateway\.test\/pay\//;

test.beforeEach(async ({ page }) => {
  await page.route('https://fake-gateway.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Fake gateway</title><h1>Fake gateway pay page</h1>',
    }),
  );
  await page.route('https://shop.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Plan page</title>' }),
  );
});

/**
 * Buys a plan with the fake (redirect) gateway from the host page at `path`
 * and returns the attempt key and the return URL the checkout gave it, once
 * the whole tab is on the gateway's page.
 */
async function leaveForGateway(
  page: Page,
  planId: string,
  path = '/',
): Promise<{ attemptKey: string; returnUrl: string }> {
  await page.goto(path);
  await page.locator(`[data-plan-id="${planId}"]`).getByRole('button', { name: 'Mua ngay' }).click();
  const frame = page.frameLocator('[data-paybridge-modal] iframe');
  const attemptRequest = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/api\/checkout\/payments\/[^/]+\/attempts$/.test(r.url()),
  );
  await frame.getByRole('button', { name: 'Fake gateway' }).click();
  const { returnUrl } = (await attemptRequest).postDataJSON() as { returnUrl: string };

  await page.waitForURL(GATEWAY_PAGE);
  await expect(page.getByRole('heading', { name: 'Fake gateway pay page' })).toBeVisible();
  const attemptKey = new URL(page.url()).pathname.split('/').pop()!;
  return { attemptKey, returnUrl };
}

/** The gateway's signed callback for the attempt. */
async function gatewayCallback(attemptKey: string, status: 'SUCCEEDED' | 'FAILED', amount: string | null) {
  const body = JSON.stringify({ attemptKey, status, amount });
  const signature = createHmac('sha256', SEED.fakeSecret).update(body).digest('hex');
  const res = await fetch(`${API_URL}/api/webhooks/fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    body,
  });
  expect(res.ok).toBe(true);
}

/** The gateway sends the browser back, adding its own parameters as gateways do. */
async function comeBack(page: Page, returnUrl: string, gatewayParams: Record<string, string>) {
  const url = new URL(returnUrl);
  for (const [name, value] of Object.entries(gatewayParams)) url.searchParams.set(name, value);
  await page.goto(url.toString());
}

test('pays by redirect and lands on the snippet\'s success URL', async ({ page }) => {
  const success = `${ALLOWED_HOST}/thanks`;
  const cancel = `${ALLOWED_HOST}/sorry`;
  const { attemptKey, returnUrl } = await leaveForGateway(
    page,
    SEED.plans.basic,
    `/?successUrl=${encodeURIComponent(success)}&cancelUrl=${encodeURIComponent(cancel)}`,
  );
  expect(returnUrl.startsWith(`${CHECKOUT_URL}/return?`)).toBe(true);

  await gatewayCallback(attemptKey, 'SUCCEEDED', '99000');
  await comeBack(page, returnUrl, { vnp_ResponseCode: '00' });

  await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForURL(success);
  await expect(page.getByRole('heading', { name: 'Shop thanks' })).toBeVisible();
});

test('uses the Pricing Plan\'s success URL when the snippet sets none', async ({ page }) => {
  const { attemptKey, returnUrl } = await leaveForGateway(page, SEED.plans.pro);

  await gatewayCallback(attemptKey, 'SUCCEEDED', '299000');
  await comeBack(page, returnUrl, {});

  await page.waitForURL('https://shop.example/thanks', { timeout: 20_000 });
});

test('falls back to the host page the Customer started from', async ({ page }) => {
  const { attemptKey, returnUrl } = await leaveForGateway(page, SEED.plans.basic, '/?lang=vi&from=pricing');

  await gatewayCallback(attemptKey, 'SUCCEEDED', '99000');
  await comeBack(page, returnUrl, {});

  await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForURL(`${ALLOWED_HOST}/?lang=vi&from=pricing`);
  await expect(page.locator('[data-plan-id]').first()).toBeVisible();
});

test('sends a Customer who gave up at the gateway to the cancel URL', async ({ page }) => {
  const cancel = `${ALLOWED_HOST}/sorry`;
  const { attemptKey, returnUrl } = await leaveForGateway(
    page,
    SEED.plans.basic,
    `/?cancelUrl=${encodeURIComponent(cancel)}`,
  );

  await gatewayCallback(attemptKey, 'FAILED', null);
  await comeBack(page, returnUrl, { vnp_ResponseCode: '24' });

  await expect(page.getByRole('heading', { name: 'Thanh toán chưa hoàn tất' })).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForURL(cancel);
});

test('uses the Pricing Plan\'s cancel URL when the snippet sets none', async ({ page }) => {
  const { attemptKey, returnUrl } = await leaveForGateway(page, SEED.plans.pro);

  await gatewayCallback(attemptKey, 'FAILED', null);
  await comeBack(page, returnUrl, {});

  await page.waitForURL('https://shop.example/pricing', { timeout: 20_000 });
});

test('does not take the gateway\'s parameters as proof of payment', async ({ page }) => {
  const success = `${ALLOWED_HOST}/thanks`;
  const { attemptKey, returnUrl } = await leaveForGateway(
    page,
    SEED.plans.basic,
    `/?successUrl=${encodeURIComponent(success)}`,
  );

  // The gateway says "paid" in the URL, but no callback has arrived.
  await comeBack(page, returnUrl, { vnp_ResponseCode: '00', status: 'SUCCEEDED', paid: 'true' });

  await expect(page.getByRole('heading', { name: 'Thanh toán đang được xử lý' })).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(page.url().startsWith(`${CHECKOUT_URL}/return?`)).toBe(true);

  // Once the API says it succeeded, the page moves on by itself.
  await gatewayCallback(attemptKey, 'SUCCEEDED', '99000');
  await page.waitForURL(success, { timeout: 20_000 });
});

test('ignores a success URL on an origin the key does not allow', async ({ page }) => {
  const { attemptKey, returnUrl } = await leaveForGateway(page, SEED.plans.basic, '/?from=pricing');
  await gatewayCallback(attemptKey, 'SUCCEEDED', '99000');

  const forged = new URL(returnUrl);
  forged.searchParams.set('success', 'https://evil.example/phish');
  await page.goto(forged.toString());

  await page.waitForURL(`${ALLOWED_HOST}/?from=pricing`, { timeout: 20_000 });
});
