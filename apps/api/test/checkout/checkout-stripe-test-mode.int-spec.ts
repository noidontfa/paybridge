import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import {
  START_RATE_LIMIT_OPTIONS,
  type StartRateLimitOptions,
} from '../../src/checkout/infrastructure/rate-limit/redis-start-rate-limiter.js';
import { STRIPE_API_VERSION } from '../../src/gateways/stripe/stripe-gateway.plugin.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { ManageGatewayConnections } from '../../src/payment-core/application/use-cases/manage-gateway-connections.js';
import { RequeryAttempt } from '../../src/payment-core/application/workers/requery-attempt.js';
import { bearer } from '../setup/api-keys.js';
import {
  createPricingPlan,
  createPublishableKey,
  SHOP_ORIGIN,
} from '../setup/checkout.js';
import { defaultScope } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 11, against a real Stripe account in TEST MODE: a checkout Payment
// paid with Stripe, a decline first and then a good card, on the same attempt.
// The browser's `stripe.confirmPayment` is played by a server-side confirm
// with Stripe's test PaymentMethods. Skipped unless both test keys are set:
//
//   STRIPE_TEST_SECRET_KEY=sk_test_… STRIPE_TEST_PUBLISHABLE_KEY=pk_test_… pnpm test:int
//
// Live keys are refused: this file never runs against live mode.

const SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY ?? '';
const PUBLISHABLE_KEY = process.env.STRIPE_TEST_PUBLISHABLE_KEY ?? '';
const enabled =
  SECRET_KEY.startsWith('sk_test_') && PUBLISHABLE_KEY.startsWith('pk_test_');

const PAYMENTS = '/api/checkout/payments';
const RETURN_URL = 'https://checkout.paybridge.test/return';
const NO_LIMITS: Omit<StartRateLimitOptions, 'redisUrl' | 'keyPrefix'> = {
  perPublishableKey: 1_000_000,
  perClientIp: 1_000_000,
  windowSeconds: 60,
};

describe.skipIf(!enabled)('Stripe in the checkout, in Stripe test mode', () => {
  const prisma = createTestPrismaClient();
  let stripe: Stripe;
  let app: INestApplication;
  let moduleRef: TestingModule;
  let key: string;

  beforeAll(async () => {
    stripe = new Stripe(SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    await resetDatabase(prisma);
    await prisma.publishableKey.deleteMany();
    ({ key } = await createPublishableKey(prisma));
    await moduleRef.get(ManageGatewayConnections).create(defaultScope, {
      gatewayId: 'stripe',
      credentials: {
        secretKey: SECRET_KEY,
        publishableKey: PUBLISHABLE_KEY,
        // No webhook reaches this test; the status comes from a requery.
        webhookSecret: 'whsec_unused_in_this_test',
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  const call = (req: request.Test) =>
    req.set(bearer(key)).set('Origin', SHOP_ORIGIN);

  it('declines a card on the attempt, then succeeds on the same attempt', async () => {
    const planId = await createPricingPlan(prisma, undefined, {
      amount: '150000',
      allowedGatewayIds: ['stripe'],
    });
    const payment = await call(request(app.getHttpServer()).post(PAYMENTS))
      .send({ pricingPlanId: planId, sessionToken: 'session-token-stripe-test-mode' })
      .expect(201);
    const started = await call(
      request(app.getHttpServer()).post(`${PAYMENTS}/${payment.body.id}/attempts`),
    )
      .send({ gatewayId: 'stripe', returnUrl: RETURN_URL })
      .expect(201);
    const attempt = started.body.attempt;
    expect(attempt.nextAction).toMatchObject({
      type: 'CLIENT_SDK',
      clientParams: { publishableKey: PUBLISHABLE_KEY, returnUrl: RETURN_URL },
    });
    const intentId = (attempt.nextAction.token as string).split('_secret_')[0]!;

    await expect(
      stripe.paymentIntents.confirm(intentId, {
        payment_method: 'pm_card_chargeDeclined',
        return_url: RETURN_URL,
      }),
    ).rejects.toMatchObject({ type: 'StripeCardError' });
    await moduleRef.get(RequeryAttempt).execute(attempt.id);

    const declined = await call(
      request(app.getHttpServer()).get(`${PAYMENTS}/${payment.body.id}`),
    ).expect(200);
    expect(declined.body).toMatchObject({
      status: 'PENDING',
      attempt: { id: attempt.id, status: 'PENDING' },
    });

    await stripe.paymentIntents.confirm(intentId, {
      payment_method: 'pm_card_visa',
      return_url: RETURN_URL,
    });
    await moduleRef.get(RequeryAttempt).execute(attempt.id);

    const paid = await call(
      request(app.getHttpServer()).get(`${PAYMENTS}/${payment.body.id}`),
    ).expect(200);
    expect(paid.body).toMatchObject({ status: 'SUCCEEDED', attempt: { id: attempt.id } });
  }, 60_000);
});
