import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// GET /api/payments/:id over HTTP: the Payment with all its attempts.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new FakeClock(NOW))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function createPayment(): Promise<{ id: string; ref: string }> {
  const ref = `order-${newId()}`;
  const res = await request(app.getHttpServer())
    .post('/api/payments')
    .send({ amount: '150000', currency: 'VND', upstreamReference: ref })
    .expect(201);
  return { id: res.body.id as string, ref };
}

function get(id: string) {
  return request(app.getHttpServer()).get(`/api/payments/${id}`);
}

describe('GET /api/payments/:id', () => {
  it('200 with the Payment and no attempts before any attempt starts', async () => {
    const { id, ref } = await createPayment();

    const res = await get(id).expect(200);

    expect(res.body).toEqual({
      id,
      upstreamReference: ref,
      amount: '150000',
      currency: 'VND',
      status: 'PENDING',
      expiresAt: '2026-05-01T10:30:00.000Z',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      attempts: [],
    });
  });

  it('lists every attempt oldest first, without raw responses or provider metadata', async () => {
    const { id } = await createPayment();
    const failedId = newId();
    const reviewId = newId();
    const pendingId = newId();
    await repos().payments.createAttempt(defaultScope, {
      id: failedId,
      paymentId: id,
      gatewayId: 'fake',
      status: 'CREATED',
      providerRef: 'prov-1',
      providerMetadata: { secretish: 'internal-1' },
    });
    await repos().payments.updateAttempt(defaultScope, failedId, {
      status: 'FAILED',
    });
    await repos().payments.createAttempt(defaultScope, {
      id: reviewId,
      paymentId: id,
      gatewayId: 'fake',
      status: 'CREATED',
    });
    await repos().payments.updateAttempt(defaultScope, reviewId, {
      status: 'REQUIRES_REVIEW',
      reviewReason: 'AMOUNT_MISMATCH',
      reviewOpenedAt: new Date('2026-05-01T10:05:00.000Z'),
      refundRequired: true,
    });
    await repos().payments.createAttempt(defaultScope, {
      id: pendingId,
      paymentId: id,
      gatewayId: 'other-gateway',
      status: 'PENDING',
      providerMetadata: { secretish: 'internal-3' },
      nextAction: { type: 'REDIRECT', url: 'https://pay.example/abc' },
    });
    await repos().gatewayRawResponses.record(defaultScope, {
      attemptId: pendingId,
      operation: 'initiate',
      payload: { rawSecret: 'raw-payload' },
    });

    const res = await get(id).expect(200);

    const timestamps = {
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    };
    expect(res.body.attempts).toEqual([
      {
        id: failedId,
        gatewayId: 'fake',
        status: 'FAILED',
        refundRequired: false,
        ...timestamps,
      },
      {
        id: reviewId,
        gatewayId: 'fake',
        status: 'REQUIRES_REVIEW',
        reviewReason: 'AMOUNT_MISMATCH',
        reviewOpenedAt: '2026-05-01T10:05:00.000Z',
        refundRequired: true,
        ...timestamps,
      },
      {
        id: pendingId,
        gatewayId: 'other-gateway',
        status: 'PENDING',
        nextAction: { type: 'REDIRECT', url: 'https://pay.example/abc' },
        refundRequired: false,
        ...timestamps,
      },
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/internal-|raw-payload|prov-1/);
  });

  it.each([
    ['an unknown UUID', newId()],
    ['an id that is not a UUID', 'not-a-uuid'],
  ])('404 for %s', async (_label, id) => {
    const res = await get(id).expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      path: `/api/payments/${id}`,
    });
  });

  it('writes no rows', async () => {
    const { id } = await createPayment();
    const before = await rowCounts();
    const row = await prisma.payment.findUniqueOrThrow({ where: { id } });

    await get(id).expect(200);

    expect(await rowCounts()).toEqual(before);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id } })).toEqual(
      row,
    );
  });

  it('takes no row lock: reads while another transaction holds the Payment row lock', async () => {
    const { id } = await createPayment();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM core_payments WHERE id = ${id}::uuid FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 10_000 },
    );
    await lockTaken;

    try {
      const res = await get(id).timeout(3_000).expect(200);
      expect(res.body.id).toBe(id);
    } finally {
      release();
      await holder;
    }
  });
});

function repos(): Repositories {
  return app.get(TransactionRunner).repositories;
}

async function rowCounts() {
  return {
    payments: await prisma.payment.count(),
    attempts: await prisma.paymentTransaction.count(),
    transitions: await prisma.statusTransition.count(),
    outbox: await prisma.outboxEvent.count(),
    rawResponses: await prisma.gatewayRawResponse.count(),
  };
}
