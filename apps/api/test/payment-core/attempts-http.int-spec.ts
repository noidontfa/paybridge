import { GatewayManager } from '../../src/payment-core/application/gateway-manager.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import {
  Clock,
  FakeClock,
} from '../../src/payment-core/domain/services/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayRejectedError } from '../../src/payment-core/port/index.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { bearer, createApiKey } from '../setup/api-keys.js';

// POST /api/payments/:paymentId/attempts over HTTP: validation, the response
// shape and the mapping of domain errors. Rules are covered in depth by
// start-attempt.int-spec.ts.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
let apiKey: string;
let app: INestApplication;
let fake: FakeGatewayPlugin;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new FakeClock(NOW))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
  apiKey = await createApiKey(prisma);
  fake = app
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  fake.reset();
  await resetDatabase(prisma);
});

async function createPayment(): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/payments')
    .set(bearer(apiKey))
    .send({
      amount: '150000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    })
    .expect(201);
  return res.body.id as string;
}

function startAttempt(paymentId: string, body: object) {
  return request(app.getHttpServer())
    .post(`/api/payments/${paymentId}/attempts`)
    .set(bearer(apiKey))
    .send(body);
}

const BODY = { gatewayId: 'fake', returnUrl: 'https://shop.example/return' };

describe('POST /api/payments/:paymentId/attempts', () => {
  it('201 with the PENDING attempt, its next action and the Payment', async () => {
    const paymentId = await createPayment();

    const res = await startAttempt(paymentId, BODY).expect(201);

    expect(res.body).toEqual({
      attempt: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        gatewayId: 'fake',
        status: 'PENDING',
        providerRef: null,
        nextAction: {
          type: 'REDIRECT',
          url: `https://fake-gateway.test/pay/${res.body.attempt.id}`,
        },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      payment: expect.objectContaining({ id: paymentId, status: 'PENDING' }),
    });
  });

  it('returns clientParams of a CLIENT_SDK next action unchanged, and GET shows the same', async () => {
    const paymentId = await createPayment();
    const nextAction = {
      type: 'CLIENT_SDK',
      token: 'secret_1',
      clientParams: {
        publishableKey: 'pk_test_1',
        returnUrl: 'https://shop.example/return',
      },
    } as const;
    fake.scriptInitiate({
      nextAction,
      providerMetadata: {},
      rawPayload: {},
    });

    const res = await startAttempt(paymentId, BODY).expect(201);

    expect(res.body.attempt.nextAction).toEqual(nextAction);
    const stored = await prisma.paymentTransaction.findUnique({
      where: { id: res.body.attempt.id },
    });
    expect(stored?.nextAction).toEqual(nextAction);
    const detail = await request(app.getHttpServer())
      .get(`/api/payments/${paymentId}`)
      .set(bearer(apiKey))
      .expect(200);
    expect(detail.body.attempts[0].nextAction).toEqual(nextAction);
  });

  it('201 with a FAILED attempt when the gateway rejects it', async () => {
    const paymentId = await createPayment();
    fake.scriptInitiate(new GatewayRejectedError('declined'));

    const res = await startAttempt(paymentId, BODY).expect(201);

    expect(res.body.attempt).toMatchObject({
      status: 'FAILED',
      nextAction: null,
    });
  });

  it('switches gateway on the same route: a second attempt cancels the open one', async () => {
    const paymentId = await createPayment();
    const first = await startAttempt(paymentId, BODY).expect(201);

    const res = await startAttempt(paymentId, BODY).expect(201);

    expect(res.body.attempt.status).toBe('PENDING');
    const old = await prisma.paymentTransaction.findUnique({
      where: { id: first.body.attempt.id },
    });
    expect(old?.status).toBe('CANCELLED');
  });

  it('409 when the Payment is not PENDING', async () => {
    const paymentId = await createPayment();
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'CANCELLED' },
    });

    const res = await startAttempt(paymentId, BODY).expect(409);

    expect(res.body).toMatchObject({
      message: expect.stringContaining('not PENDING'),
    });
  });

  it('404 for an unknown Payment', async () => {
    const res = await startAttempt(newId(), BODY).expect(404);

    expect(res.body).toMatchObject({
      message: expect.stringContaining('not found'),
    });
  });

  it('400 for an unknown gateway', async () => {
    const paymentId = await createPayment();

    const res = await startAttempt(paymentId, {
      ...BODY,
      gatewayId: 'nope',
    }).expect(400);

    expect(res.body).toMatchObject({
      message: expect.stringContaining('not available'),
    });
  });

  it.each([
    ['no gateway', { returnUrl: BODY.returnUrl }],
    ['no return URL', { gatewayId: 'fake' }],
    ['a non-http return URL', { ...BODY, returnUrl: 'javascript:alert(1)' }],
  ])('400 for %s', async (_name, body) => {
    const paymentId = await createPayment();

    await startAttempt(paymentId, body).expect(400);
  });

  it('400 for a Payment id that is not a UUID', async () => {
    await startAttempt('not-a-uuid', BODY).expect(400);
  });
});
