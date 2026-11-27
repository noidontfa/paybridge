import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import {
  START_RATE_LIMIT_OPTIONS,
  type StartRateLimitOptions,
} from '../../src/checkout/infrastructure/rate-limit/redis-start-rate-limiter.js';
import { STRIPE_HTTP_CLIENT } from '../../src/gateways/gateways.module.js';
import { FixtureHttpClient } from '../../src/gateways/stripe/fixture-http-client.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { ManageGatewayConnections } from '../../src/payment-core/application/use-cases/manage-gateway-connections.js';
import { ProcessWebhook } from '../../src/payment-core/application/workers/process-webhook.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { TransactionRunner } from '../../src/payment-core/domain/repositories/transaction-runner.js';
import { bearer } from '../setup/api-keys.js';
import {
  createPricingPlan,
  createPublishableKey,
  SHOP_ORIGIN,
} from '../setup/checkout.js';
import { defaultScope } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 11: Stripe in the checkout. The browser starts a Stripe attempt
// through the public checkout endpoints and gets what Stripe.js needs; a
// decline leaves it on the same attempt. Stripe's HTTP layer replays recorded
// responses and its webhooks are signed locally: nothing reaches Stripe.

const CREDENTIALS = {
  secretKey: 'sk_test_checkout',
  webhookSecret: 'whsec_checkout',
  publishableKey: 'pk_test_checkout',
};
const PAYMENTS = '/api/checkout/payments';
const SESSION = 'session-token-0123456789abcdef';
const RETURN_URL = 'https://checkout.paybridge.test/return?paymentId=p-1';
const PI_ID = 'pi_3QxTest1AbCdEfGh0aBcDeFg';

const NO_LIMITS: Omit<StartRateLimitOptions, 'redisUrl' | 'keyPrefix'> = {
  perPublishableKey: 1_000_000,
  perClientIp: 1_000_000,
  windowSeconds: 60,
};

const prisma = createTestPrismaClient();
const stripeHttp = new FixtureHttpClient();
const stripe = new Stripe(CREDENTIALS.secretKey);
let app: INestApplication;
let moduleRef: TestingModule;
let key: string;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STRIPE_HTTP_CLIENT)
    .useValue(stripeHttp)
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

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.publishableKey.deleteMany();
  ({ key } = await createPublishableKey(prisma));
  // The Organization's own Stripe account (ADR 0007).
  await moduleRef.get(ManageGatewayConnections).create(defaultScope, {
    gatewayId: 'stripe',
    credentials: CREDENTIALS,
  });
});

const server = () => app.getHttpServer();
const call = (req: request.Test) =>
  req.set(bearer(key)).set('Origin', SHOP_ORIGIN);

async function stripeAttempt() {
  const planId = await createPricingPlan(prisma, undefined, {
    amount: '150000',
    allowedGatewayIds: ['stripe'],
  });
  const payment = await call(request(server()).post(PAYMENTS))
    .send({ pricingPlanId: planId, sessionToken: SESSION })
    .expect(201);
  stripeHttp.respond(200, 'payment-intent.requires-payment-method');
  const res = await call(
    request(server()).post(`${PAYMENTS}/${payment.body.id}/attempts`),
  )
    .send({ gatewayId: 'stripe', returnUrl: RETURN_URL })
    .expect(201);
  return { paymentId: payment.body.id as string, attempt: res.body.attempt };
}

/** A Stripe webhook about the attempt's PaymentIntent, processed at once. */
async function stripeEvent(
  attemptKey: string,
  type: string,
  object: Record<string, unknown>,
) {
  const body = JSON.stringify({
    id: `evt_${newId().replaceAll('-', '')}`,
    object: 'event',
    type,
    livemode: false,
    data: {
      object: {
        id: PI_ID,
        object: 'payment_intent',
        amount: 150000,
        amount_received: 0,
        livemode: false,
        metadata: { attemptKey },
        ...object,
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: CREDENTIALS.webhookSecret,
  });
  const runner = moduleRef.get(TransactionRunner, { strict: false });
  const { entry } = await runner.repositories.webhookInbox.record(
    defaultScope,
    {
      gatewayId: 'stripe',
      dedupeKey: newId(),
      attemptKey,
      rawBody: new TextEncoder().encode(body),
      headers: { 'stripe-signature': header },
      query: {},
    },
  );
  expect(await moduleRef.get(ProcessWebhook).execute(entry.id)).toBe(
    'processed',
  );
}

const status = (paymentId: string) =>
  call(request(server()).get(`${PAYMENTS}/${paymentId}`)).expect(200);

describe('a Stripe attempt in the checkout', () => {
  it("hands the checkout page Stripe.js's client secret, publishable key and return URL", async () => {
    const { attempt } = await stripeAttempt();

    expect(attempt).toMatchObject({
      gatewayId: 'stripe',
      status: 'PENDING',
      nextAction: {
        type: 'CLIENT_SDK',
        token: `${PI_ID}_secret_TestSecretValue123`,
        clientParams: {
          publishableKey: CREDENTIALS.publishableKey,
          returnUrl: RETURN_URL,
        },
      },
    });
  });

  it('keeps the Customer on the same open attempt after a decline, and succeeds on the retry', async () => {
    const { paymentId, attempt } = await stripeAttempt();

    await stripeEvent(attempt.id, 'payment_intent.payment_failed', {
      status: 'requires_payment_method',
      last_payment_error: { type: 'card_error', code: 'card_declined' },
    });

    const declined = await status(paymentId);
    expect(declined.body).toMatchObject({
      status: 'PENDING',
      attempt: { id: attempt.id, status: 'PENDING', nextAction: attempt.nextAction },
    });

    await stripeEvent(attempt.id, 'payment_intent.succeeded', {
      status: 'succeeded',
      amount_received: 150000,
    });

    expect((await status(paymentId)).body).toMatchObject({
      status: 'SUCCEEDED',
      attempt: { id: attempt.id },
    });
  });
});
