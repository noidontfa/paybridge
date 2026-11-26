import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { STRIPE_HTTP_CLIENT } from '../../src/gateways/gateways.module.js';
import { FixtureHttpClient } from '../../src/gateways/stripe/fixture-http-client.js';
import { ManageGatewayConnections } from '../../src/payment-core/application/use-cases/manage-gateway-connections.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { defaultScope } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { bearer, createApiKey } from '../setup/api-keys.js';

// End to end: a merchant starts a Stripe attempt over HTTP. The Stripe SDK's
// HTTP layer replays a recorded PaymentIntent create response; no live calls.

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_e2e',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_e2e',
};

const prisma = createTestPrismaClient();
let apiKey: string;
const stripeHttp = new FixtureHttpClient();
let app: INestApplication;
let connections: ManageGatewayConnections;

beforeAll(async () => {
  Object.assign(process.env, STRIPE_ENV);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STRIPE_HTTP_CLIENT)
    .useValue(stripeHttp)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
  apiKey = await createApiKey(prisma);
  connections = moduleRef.get(ManageGatewayConnections);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  for (const key of Object.keys(STRIPE_ENV)) delete process.env[key];
});

beforeEach(async () => {
  await resetDatabase(prisma);
  // The Organization's own Stripe account (ADR 0007).
  await connections.create(defaultScope, {
    gatewayId: 'stripe',
    credentials: {
      secretKey: STRIPE_ENV.STRIPE_SECRET_KEY,
      webhookSecret: STRIPE_ENV.STRIPE_WEBHOOK_SECRET,
      publishableKey: STRIPE_ENV.STRIPE_PUBLISHABLE_KEY,
    },
  });
});

describe('POST /api/payments/:paymentId/attempts with gatewayId "stripe"', () => {
  it('returns a CLIENT_SDK next action with clientParams', async () => {
    stripeHttp.respond(200, 'payment-intent.requires-payment-method');
    const created = await request(app.getHttpServer())
      .post('/api/payments').set(bearer(apiKey))
      .send({
        amount: '150000',
        currency: 'VND',
        upstreamReference: `order-${newId()}`,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/payments/${created.body.id}/attempts`).set(bearer(apiKey))
      .send({ gatewayId: 'stripe', returnUrl: 'https://shop.example/return' })
      .expect(201);

    expect(res.body.attempt).toMatchObject({
      gatewayId: 'stripe',
      status: 'PENDING',
      providerRef: 'pi_3QxTest1AbCdEfGh0aBcDeFg',
      nextAction: {
        type: 'CLIENT_SDK',
        token: 'pi_3QxTest1AbCdEfGh0aBcDeFg_secret_TestSecretValue123',
        clientParams: {
          publishableKey: 'pk_test_e2e',
          returnUrl: 'https://shop.example/return',
        },
      },
    });
    expect(stripeHttp.requests).toHaveLength(1);
  });
});
