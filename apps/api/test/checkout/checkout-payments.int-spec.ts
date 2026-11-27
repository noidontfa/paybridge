import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CheckoutClock } from '../../src/checkout/domain/services/clock.js';
import {
  START_RATE_LIMIT_OPTIONS,
  type StartRateLimitOptions,
} from '../../src/checkout/infrastructure/rate-limit/redis-start-rate-limiter.js';
import type { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { GatewayManager } from '../../src/payment-core/application/gateway-manager.js';
import { ProcessWebhook } from '../../src/payment-core/application/workers/process-webhook.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { TransactionRunner } from '../../src/payment-core/domain/repositories/transaction-runner.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/services/clock.js';
import { organizationScope } from '../../src/payment-core/domain/value-objects/organization-scope.js';
import { bearer, createApiKey } from '../setup/api-keys.js';
import {
  createPricingPlan,
  createPublishableKey,
  SHOP_ORIGIN,
} from '../setup/checkout.js';
import {
  createOrganization,
  DEFAULT_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp } from '../setup/users.js';
import { paymentListSchema } from '../contract/console/payments-list.js';
import { operatorPaymentSchema } from '../contract/console/schemas.js';

// Ticket 07: a browser starts, resumes and pays checkout Payments through the
// public checkout endpoints, over HTTP on real PostgreSQL. Rate limits have
// their own file (checkout-rate-limits.int-spec.ts); here they are out of
// the way.

const NOW = new Date('2026-11-27T10:00:00.000Z');
const MINUTE = 60_000;

const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let app: INestApplication;
let moduleRef: TestingModule;

const NO_LIMITS: Omit<StartRateLimitOptions, 'redisUrl' | 'keyPrefix'> = {
  perPublishableKey: 1_000_000,
  perClientIp: 1_000_000,
  windowSeconds: 60,
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(CheckoutClock)
    .useValue(clock)
    .overrideProvider(START_RATE_LIMIT_OPTIONS)
    .useValue({
      ...NO_LIMITS,
      redisUrl: process.env.REDIS_URL,
      keyPrefix: process.env.QUEUE_PREFIX,
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let key: string;
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
  await prisma.publishableKey.deleteMany();
  await prisma.organization.update({
    where: { id: DEFAULT_ORGANIZATION_ID },
    data: { status: 'ACTIVE' },
  });
  ({ key } = await createPublishableKey(prisma));
});

const PAYMENTS = '/api/checkout/payments';
const SESSION = 'session-token-0123456789abcdef';
const RETURN_URL = 'https://checkout.paybridge.test/return';
const server = () => app.getHttpServer();

function start(body: Record<string, unknown>, publishableKey = key) {
  return request(server())
    .post(PAYMENTS)
    .set(bearer(publishableKey))
    .set('Origin', SHOP_ORIGIN)
    .send(body);
}

function startAttempt(
  paymentId: string,
  gatewayId: string,
  publishableKey = key,
) {
  return request(server())
    .post(`${PAYMENTS}/${paymentId}/attempts`)
    .set(bearer(publishableKey))
    .set('Origin', SHOP_ORIGIN)
    .send({ gatewayId, returnUrl: RETURN_URL });
}

function status(paymentId: string, publishableKey = key) {
  return request(server())
    .get(`${PAYMENTS}/${paymentId}`)
    .set(bearer(publishableKey))
    .set('Origin', SHOP_ORIGIN);
}

/** The generic "unavailable" answer, with its developer-only reason. */
function expectUnavailable(res: request.Response, reason: string) {
  expect(res.status).toBe(422);
  expect(res.body).toMatchObject({
    code: 'CHECKOUT_UNAVAILABLE',
    message: 'Payment is not available right now',
    details: { reason },
  });
}

/** A successful provider callback for the attempt, processed at once. */
async function payAttempt(attemptKey: string, amount: string) {
  const fake = moduleRef
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
  const callback = fake.signedCallback({
    status: 'SUCCEEDED',
    amount,
    attemptKey,
  });
  const runner = moduleRef.get(TransactionRunner, { strict: false });
  const { entry } = await runner.repositories.webhookInbox.record(
    organizationScope(DEFAULT_ORGANIZATION_ID),
    {
      gatewayId: 'fake',
      dedupeKey: newId(),
      attemptKey,
      rawBody: callback.rawBody,
      headers: callback.headers,
      query: callback.query,
    },
  );
  expect(await moduleRef.get(ProcessWebhook).execute(entry.id)).toBe(
    'processed',
  );
}

describe('starting a checkout Payment', () => {
  it('takes the Amount and Payment Expiry from the Pricing Plan, even when the browser sends an Amount', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      name: 'Pro',
      amount: '199000',
      expiryMinutes: 45,
    });

    const res = await start({
      pricingPlanId: planId,
      sessionToken: SESSION,
      amount: '1',
      currency: 'USD',
    }).expect(201);

    expect(res.body).toMatchObject({
      status: 'PENDING',
      amount: '199000',
      currency: 'VND',
      expiresAt: new Date(NOW.getTime() + 45 * MINUTE).toISOString(),
      pricingPlan: { id: planId, name: 'Pro' },
      attempt: null,
      resumed: false,
    });
  });

  it('resumes the open Payment of the same session, Pricing Plan and Customer Reference', async () => {
    const planId = await createPricingPlan(prisma);
    const body = {
      pricingPlanId: planId,
      sessionToken: SESSION,
      customerReference: 'user-42',
      customerEmail: 'an@example.com',
    };
    const first = await start(body).expect(201);

    clock.advance(30 * MINUTE);
    const again = await start(body).expect(200);

    expect(again.body).toMatchObject({ id: first.body.id, resumed: true });
  });

  it('starts a new Payment for another session, Pricing Plan or Customer Reference', async () => {
    const planId = await createPricingPlan(prisma);
    const otherPlanId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      name: 'Basic',
    });
    const body = {
      pricingPlanId: planId,
      sessionToken: SESSION,
      customerReference: 'user-42',
    };
    const first = await start(body).expect(201);

    const others = await Promise.all([
      start({ ...body, sessionToken: `${SESSION}-other` }),
      start({ ...body, pricingPlanId: otherPlanId }),
      start({ ...body, customerReference: 'user-43' }),
      start({ ...body, customerEmail: 'an@example.com' }),
    ]);

    const ids = others.map((r) => {
      expect(r.status).toBe(201);
      return r.body.id as string;
    });
    expect(new Set([first.body.id, ...ids]).size).toBe(5);
  });

  it('starts a new Payment once the open one has passed its Payment Expiry', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      expiryMinutes: 30,
    });
    const body = { pricingPlanId: planId, sessionToken: SESSION };
    const first = await start(body).expect(201);

    clock.advance(30 * MINUTE);
    const next = await start(body).expect(201);

    expect(next.body.id).not.toBe(first.body.id);
    expect(next.body.expiresAt).toBe(
      new Date(NOW.getTime() + 60 * MINUTE).toISOString(),
    );
  });

  it('starts a new Payment when the open one no longer accepts payment', async () => {
    const planId = await createPricingPlan(prisma);
    const body = { pricingPlanId: planId, sessionToken: SESSION };
    const first = await start(body).expect(201);
    const attempt = await startAttempt(first.body.id, 'fake').expect(201);
    await payAttempt(attempt.body.attempt.id, '199000');

    const next = await start(body).expect(201);

    expect(next.body.id).not.toBe(first.body.id);
  });

  it('refuses a malformed request without creating anything', async () => {
    const planId = await createPricingPlan(prisma);

    await start({ pricingPlanId: planId }).expect(400);
    await start({
      pricingPlanId: planId,
      sessionToken: SESSION,
      customerEmail: 'not-an-email',
    }).expect(400);
  });
});

describe('the Upstream Reference', () => {
  it('is assigned by PayBridge with a recognisable prefix, unique per Payment', async () => {
    const planId = await createPricingPlan(prisma);
    const a = await start({ pricingPlanId: planId, sessionToken: SESSION });
    const b = await start({
      pricingPlanId: planId,
      sessionToken: `${SESSION}-b`,
    });

    const refs = await prisma.payment.findMany({
      where: { id: { in: [a.body.id, b.body.id] } },
      select: { merchantOrderId: true },
    });
    expect(refs).toHaveLength(2);
    for (const { merchantOrderId } of refs) {
      expect(merchantOrderId).toMatch(/^chk_[0-9a-f-]{36}$/);
    }
    expect(refs[0]!.merchantOrderId).not.toBe(refs[1]!.merchantOrderId);
  });
});

describe('starting an attempt', () => {
  it('returns the NextAction of an allowed, enabled PaymentGateway', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      allowedGatewayIds: ['fake'],
    });
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });

    const res = await startAttempt(payment.body.id, 'fake').expect(201);

    expect(res.body.attempt).toMatchObject({
      gatewayId: 'fake',
      status: 'PENDING',
      nextAction: { type: 'REDIRECT' },
    });
    expect(res.body.payment).toMatchObject({
      id: payment.body.id,
      attempt: { id: res.body.attempt.id, status: 'PENDING' },
    });
  });

  it('refuses a PaymentGateway the Pricing Plan does not allow', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      allowedGatewayIds: ['fake'],
    });
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });

    expectUnavailable(
      await startAttempt(payment.body.id, 'alpha'),
      'GATEWAY_NOT_ALLOWED',
    );
  });

  it('refuses a PaymentGateway the Organization has disabled, even when every one is allowed', async () => {
    const planId = await createPricingPlan(prisma);
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });
    await prisma.gatewayConnection.updateMany({
      where: { organizationId: DEFAULT_ORGANIZATION_ID, gatewayId: 'alpha' },
      data: { enabled: false },
    });

    expectUnavailable(
      await startAttempt(payment.body.id, 'alpha'),
      'GATEWAY_NOT_ENABLED',
    );
    await startAttempt(payment.body.id, 'fake').expect(201);
  });

  it('refuses an unknown PaymentGateway', async () => {
    const planId = await createPricingPlan(prisma);
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });

    expectUnavailable(
      await startAttempt(payment.body.id, 'nope'),
      'GATEWAY_NOT_ENABLED',
    );
  });
});

describe('when the checkout cannot sell', () => {
  it('answers "unavailable" for an unknown Pricing Plan', async () => {
    expectUnavailable(
      await start({ pricingPlanId: newId(), sessionToken: SESSION }),
      'PRICING_PLAN_NOT_FOUND',
    );
    expectUnavailable(
      await start({ pricingPlanId: 'not-a-plan', sessionToken: SESSION }),
      'PRICING_PLAN_NOT_FOUND',
    );
  });

  it('answers "unavailable" for an archived Pricing Plan', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      status: 'ARCHIVED',
    });

    expectUnavailable(
      await start({ pricingPlanId: planId, sessionToken: SESSION }),
      'PRICING_PLAN_ARCHIVED',
    );
  });

  it('answers "unavailable" when no allowed PaymentGateway is enabled', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      allowedGatewayIds: ['alpha'],
    });
    await prisma.gatewayConnection.updateMany({
      where: { organizationId: DEFAULT_ORGANIZATION_ID, gatewayId: 'alpha' },
      data: { enabled: false },
    });

    expectUnavailable(
      await start({ pricingPlanId: planId, sessionToken: SESSION }),
      'NO_GATEWAY_AVAILABLE',
    );
  });

  it('answers "unavailable" for a suspended Organization', async () => {
    const planId = await createPricingPlan(prisma);
    await prisma.organization.update({
      where: { id: DEFAULT_ORGANIZATION_ID },
      data: { status: 'SUSPENDED' },
    });

    expectUnavailable(
      await start({ pricingPlanId: planId, sessionToken: SESSION }),
      'ORGANIZATION_SUSPENDED',
    );
  });

  it('answers "unavailable" for an unknown key or an origin not allowed', async () => {
    const planId = await createPricingPlan(prisma);
    const body = { pricingPlanId: planId, sessionToken: SESSION };

    expectUnavailable(
      await start(body, 'pb_pk_unknown_000000000000000000000000'),
      'INVALID_PUBLISHABLE_KEY',
    );
    expectUnavailable(
      await request(server())
        .post(PAYMENTS)
        .set(bearer(key))
        .set('Origin', 'https://evil.example')
        .send(body),
      'ORIGIN_NOT_ALLOWED',
    );
  });

  it('creates no Payment for any of them', async () => {
    const archived = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      status: 'ARCHIVED',
    });
    await start({ pricingPlanId: archived, sessionToken: SESSION });
    await start({ pricingPlanId: newId(), sessionToken: SESSION });

    expect(await prisma.payment.count()).toBe(0);
  });
});

describe('Payments already under way', () => {
  it('keep working after their Pricing Plan is archived', async () => {
    const planId = await createPricingPlan(prisma);
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });
    await prisma.pricingPlan.update({
      where: { id: planId },
      data: { status: 'ARCHIVED' },
    });

    const attempt = await startAttempt(payment.body.id, 'fake').expect(201);
    await payAttempt(attempt.body.attempt.id, '199000');

    const res = await status(payment.body.id).expect(200);
    expect(res.body).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('finish normally while the Organization is suspended', async () => {
    const planId = await createPricingPlan(prisma);
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });
    const attempt = await startAttempt(payment.body.id, 'fake').expect(201);
    await prisma.organization.update({
      where: { id: DEFAULT_ORGANIZATION_ID },
      data: { status: 'SUSPENDED' },
    });

    await payAttempt(attempt.body.attempt.id, '199000');

    await prisma.organization.update({
      where: { id: DEFAULT_ORGANIZATION_ID },
      data: { status: 'ACTIVE' },
    });
    const res = await status(payment.body.id).expect(200);
    expect(res.body).toMatchObject({ status: 'SUCCEEDED' });
  });
});

describe("reading a checkout Payment's status", () => {
  it('shows the Payment and its latest attempt', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      name: 'Pro',
    });
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });
    const attempt = await startAttempt(payment.body.id, 'fake').expect(201);

    const res = await status(payment.body.id).expect(200);

    expect(res.body).toEqual({
      id: payment.body.id,
      status: 'PENDING',
      amount: '199000',
      currency: 'VND',
      expiresAt: payment.body.expiresAt,
      pricingPlan: { id: planId, name: 'Pro' },
      returnUrls: { successUrl: null, cancelUrl: null },
      attempt: {
        id: attempt.body.attempt.id,
        gatewayId: 'fake',
        status: 'PENDING',
        nextAction: attempt.body.attempt.nextAction,
      },
    });
  });

  it("carries the Pricing Plan's success and cancel URLs, for the return page", async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      successUrl: 'https://shop.example.com/thanks',
      cancelUrl: 'https://shop.example.com/pricing',
    });
    const payment = await start({ pricingPlanId: planId, sessionToken: SESSION });
    expect(payment.body.returnUrls).toEqual({
      successUrl: 'https://shop.example.com/thanks',
      cancelUrl: 'https://shop.example.com/pricing',
    });

    const res = await status(payment.body.id).expect(200);

    expect(res.body.returnUrls).toEqual({
      successUrl: 'https://shop.example.com/thanks',
      cancelUrl: 'https://shop.example.com/pricing',
    });
  });

  it('does not show a Payment created through the payments API', async () => {
    const apiKey = await createApiKey(prisma);
    const created = await request(server())
      .post('/api/payments')
      .set(bearer(apiKey))
      .send({ amount: '1000', currency: 'VND', upstreamReference: 'order-1' })
      .expect(201);

    const res = await status(created.body.id).expect(404);
    expect(res.body.code).toBe('PAYMENT_NOT_FOUND');
    await startAttempt(created.body.id, 'fake').expect(404);
    await status('not-a-uuid').expect(404);
  });
});

describe('isolation between Organizations', () => {
  it("never sells or shows another Organization's Pricing Plans and Payments", async () => {
    const otherOrg = await createOrganization(prisma);
    const theirs = await createPublishableKey(prisma, otherOrg);
    const myPlan = await createPricingPlan(prisma);
    const mine = await start({ pricingPlanId: myPlan, sessionToken: SESSION });

    expectUnavailable(
      await start({ pricingPlanId: myPlan, sessionToken: SESSION }, theirs.key),
      'PRICING_PLAN_NOT_FOUND',
    );
    await status(mine.body.id, theirs.key).expect(404);
    await startAttempt(mine.body.id, 'fake', theirs.key).expect(404);
  });
});

describe('Payment Core records', () => {
  it('stores the checkout origin and carries it in every Payment Event, as the Console shows them', async () => {
    const operator = await signedInHttp(app, prisma);
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      name: 'Pro',
    });
    const payment = await start({
      pricingPlanId: planId,
      sessionToken: SESSION,
      customerReference: 'user-42',
      customerEmail: 'An@Example.com',
    });
    const attempt = await startAttempt(payment.body.id, 'fake').expect(201);
    await payAttempt(attempt.body.attempt.id, '199000');
    // A later rename changes nothing already recorded.
    await prisma.pricingPlan.update({
      where: { id: planId },
      data: { name: 'Pro (renamed)' },
    });

    const res = await operator
      .get(`/internal/payments/${payment.body.id}`)
      .expect(200);
    const detail = operatorPaymentSchema.parse(res.body);

    const origin = {
      pricingPlanId: planId,
      pricingPlanName: 'Pro',
      customerReference: 'user-42',
      customerEmail: 'an@example.com',
    };
    expect(detail.checkoutOrigin).toEqual(origin);
    expect(detail.upstreamReference).toMatch(/^chk_/);
    expect(detail.events.map((e) => e.type)).toEqual([
      'PaymentCreated',
      'PaymentSucceeded',
    ]);
    for (const event of detail.events) {
      expect(event.payload).toMatchObject({ checkoutOrigin: origin });
    }
  });

  it('shows no checkout origin on a Payment created through the payments API', async () => {
    const operator = await signedInHttp(app, prisma);
    const created = await request(server())
      .post('/api/payments')
      .set(bearer(await createApiKey(prisma)))
      .send({ amount: '1000', currency: 'VND', upstreamReference: 'order-1' })
      .expect(201);

    const res = await operator
      .get(`/internal/payments/${created.body.id}`)
      .expect(200);
    const detail = operatorPaymentSchema.parse(res.body);

    expect(detail.checkoutOrigin).toBeNull();
    expect(detail.events[0]!.payload).not.toHaveProperty('checkoutOrigin');
  });

  it('filters the Payments list by Pricing Plan', async () => {
    const operator = await signedInHttp(app, prisma);
    const pro = await createPricingPlan(prisma);
    const basic = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      name: 'Basic',
    });
    const a = await start({ pricingPlanId: pro, sessionToken: SESSION });
    const b = await start({ pricingPlanId: pro, sessionToken: `${SESSION}-b` });
    await start({ pricingPlanId: basic, sessionToken: SESSION });
    await request(server())
      .post('/api/payments')
      .set(bearer(await createApiKey(prisma)))
      .send({ amount: '1000', currency: 'VND', upstreamReference: 'order-1' })
      .expect(201);

    const res = await operator
      .get(`/internal/payments?pricingPlanId=${pro}`)
      .expect(200);
    const list = paymentListSchema.parse(res.body);

    expect(new Set(list.items.map((p) => p.id))).toEqual(
      new Set([a.body.id, b.body.id]),
    );
    expect(list.items).toHaveLength(2);
    const all = paymentListSchema.parse(
      (await operator.get('/internal/payments').expect(200)).body,
    );
    expect(all.items).toHaveLength(4);
    await operator.get('/internal/payments?pricingPlanId=nope').expect(400);
  });

  it('refuses to delete a Pricing Plan that has a checkout Payment', async () => {
    const admin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
    });
    const planId = await createPricingPlan(prisma);
    const unused = await createPricingPlan(prisma);
    await start({ pricingPlanId: planId, sessionToken: SESSION }).expect(201);

    const res = await admin.delete(`/internal/pricing-plans/${planId}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRICING_PLAN_IN_USE');
    await admin.delete(`/internal/pricing-plans/${unused}`).expect(200);
  });
});
