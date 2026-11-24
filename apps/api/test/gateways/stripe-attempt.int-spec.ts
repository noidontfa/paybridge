import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { STRIPE_HTTP_CLIENT } from '../../src/gateways/gateways.module.js';
import { FixtureHttpClient } from '../../src/gateways/stripe/fixture-http-client.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// End to end: a merchant starts a Stripe attempt over HTTP. The Stripe SDK's
// HTTP layer replays a recorded PaymentIntent create response; no live calls.

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_e2e',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_e2e',
};

const prisma = createTestPrismaClient();
const stripeHttp = new FixtureHttpClient();
let app: INestApplication;

beforeAll(async () => {
  Object.assign(process.env, STRIPE_ENV);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STRIPE_HTTP_CLIENT)
    .useValue(stripeHttp)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  for (const key of Object.keys(STRIPE_ENV)) delete process.env[key];
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

describe('POST /api/payments/:paymentId/attempts with gatewayId "stripe"', () => {
  it('returns a CLIENT_SDK next action with clientParams', async () => {
    stripeHttp.respond(200, 'payment-intent.requires-payment-method');
    const created = await request(app.getHttpServer())
      .post('/api/payments')
      .send({
        amount: '150000',
        currency: 'VND',
        upstreamReference: `order-${newId()}`,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/payments/${created.body.id}/attempts`)
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
