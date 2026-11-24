import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { ReviewReason } from '../../src/payment-core/domain/statuses.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 29: operator review resolution over HTTP.

const HOUR = 60 * 60 * 1000;
const OPENED = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(new Date(OPENED.getTime() + 73 * HOUR));
let app: INestApplication;
let service: PaymentService;
let runner: TransactionRunner;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
  service = moduleRef.get(PaymentService);
  runner = moduleRef.get(TransactionRunner);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(new Date(OPENED.getTime() + 73 * HOUR));
  await resetDatabase(prisma);
});

async function seedReview(
  reason: ReviewReason,
  options: { openedAt?: Date; extraOpenAttempt?: boolean } = {},
) {
  const { payment } = await service.createPayment({
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  const attemptId = newId();
  await runner.run(async (tx) => {
    await tx.payments.createAttempt({
      id: attemptId,
      paymentId: payment.id,
      gatewayId: 'fake',
      status: 'REQUIRES_REVIEW',
    });
    await tx.payments.updateAttempt(attemptId, {
      reviewReason: reason,
      reviewOpenedAt: options.openedAt ?? OPENED,
      refundRequired: true,
    });
    if (options.extraOpenAttempt) {
      await tx.payments.createAttempt({
        id: newId(),
        paymentId: payment.id,
        gatewayId: 'fake',
        status: 'PENDING',
      });
    }
  });
  return { paymentId: payment.id, attemptId };
}

const resolve = (paymentId: string, body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .post(`/internal/payments/${paymentId}/review-resolution`)
    .send(body);

const attemptRow = (id: string) =>
  prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id } });
const outbox = (paymentId: string, eventType: 'PaymentSucceeded') =>
  prisma.outboxEvent.findMany({ where: { paymentId, eventType } });
const trail = (entityId: string) =>
  prisma.statusTransition.findMany({
    where: { entityId },
    orderBy: { createdAt: 'asc' },
  });

describe('POST /internal/payments/:id/review-resolution', () => {
  it('is registered only under the internal prefix', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
    );
    const body = { attemptId, actor: 'ops.alice', note: 'n', status: 'FAILED' };
    const server = request(app.getHttpServer());

    await server
      .post(`/api/payments/${paymentId}/review-resolution`)
      .send(body)
      .expect(404);
    await server
      .post(`/api/internal/payments/${paymentId}/review-resolution`)
      .send(body)
      .expect(404);
    await server
      .post(`/payments/${paymentId}/review-resolution`)
      .send(body)
      .expect(404);
    await resolve(paymentId, body).expect(200);
  });

  it('requires a note and an actor', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
    );

    await resolve(paymentId, {
      attemptId,
      actor: 'ops.alice',
      status: 'FAILED',
    }).expect(400);
    await resolve(paymentId, {
      attemptId,
      actor: 'ops.alice',
      note: '   ',
      status: 'FAILED',
    }).expect(400);
    await resolve(paymentId, { attemptId, note: 'x', status: 'FAILED' }).expect(
      400,
    );
    expect((await attemptRow(attemptId)).status).toBe('REQUIRES_REVIEW');
  });

  it('409 before the review is 72 hours old', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
      { openedAt: new Date(clock.now().getTime() - 71 * HOUR) },
    );

    const res = await resolve(paymentId, {
      attemptId,
      actor: 'ops.alice',
      note: 'too early',
      status: 'FAILED',
    }).expect(409);

    expect(res.body.code).toBe('REVIEW_WINDOW_OPEN');
    expect((await attemptRow(attemptId)).status).toBe('REQUIRES_REVIEW');
  });

  it('FAILED: attempt fails, Payment stays PENDING, audit row has actor and note', async () => {
    const { paymentId, attemptId } = await seedReview('AMOUNT_MISMATCH');

    const res = await resolve(paymentId, {
      attemptId,
      actor: 'ops.alice',
      note: 'provider confirmed no money',
      status: 'FAILED',
    }).expect(200);

    expect(res.body.status).toBe('PENDING');
    const attempt = await attemptRow(attemptId);
    expect(attempt.status).toBe('FAILED');
    expect(attempt.refundRequired).toBe(false);
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
    expect(await outbox(paymentId, 'PaymentSucceeded')).toHaveLength(0);
    expect(await trail(attemptId)).toEqual([
      expect.objectContaining({
        fromStatus: 'REQUIRES_REVIEW',
        toStatus: 'FAILED',
        trigger: 'operator_resolution',
        actor: 'ops.alice',
        reason: 'provider confirmed no money',
      }),
    ]);
  });

  it('SUCCEEDED with an equal amount succeeds the Payment and writes the outbox row', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
      { extraOpenAttempt: true },
    );

    const res = await resolve(paymentId, {
      attemptId,
      actor: 'ops.bob',
      note: 'bank statement shows 150000',
      status: 'SUCCEEDED',
      amount: '150000',
    }).expect(200);

    expect(res.body.status).toBe('SUCCEEDED');
    const attempt = await attemptRow(attemptId);
    expect(attempt.status).toBe('SUCCEEDED');
    expect(attempt.refundRequired).toBe(false);
    expect(await outbox(paymentId, 'PaymentSucceeded')).toHaveLength(1);
    expect(await trail(attemptId)).toEqual([
      expect.objectContaining({
        toStatus: 'SUCCEEDED',
        actor: 'ops.bob',
        reason: 'bank statement shows 150000',
      }),
    ]);
    const others = await prisma.paymentTransaction.findMany({
      where: { paymentId, id: { not: attemptId } },
    });
    expect(others.map((a) => a.status)).toEqual(['CANCELLED']);
  });

  it('SUCCEEDED is refused for a different or missing amount, a non-PENDING Payment, and AMOUNT_MISMATCH', async () => {
    const a = await seedReview('AMBIGUOUS_PROVIDER_STATUS');
    const body = (attemptId: string, extra: Record<string, unknown>) => ({
      attemptId,
      actor: 'ops.bob',
      note: 'n',
      status: 'SUCCEEDED',
      ...extra,
    });

    await resolve(a.paymentId, body(a.attemptId, { amount: '100' })).expect(
      409,
    );
    await resolve(a.paymentId, body(a.attemptId, {})).expect(409);
    await prisma.payment.update({
      where: { id: a.paymentId },
      data: { status: 'EXPIRED' },
    });
    await resolve(a.paymentId, body(a.attemptId, { amount: '150000' })).expect(
      409,
    );

    const m = await seedReview('AMOUNT_MISMATCH');
    await resolve(m.paymentId, body(m.attemptId, { amount: '150000' })).expect(
      409,
    );

    for (const id of [a.attemptId, m.attemptId]) {
      expect((await attemptRow(id)).status).toBe('REQUIRES_REVIEW');
    }
    expect(await outbox(a.paymentId, 'PaymentSucceeded')).toHaveLength(0);
  });

  it.each(['LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS'] as const)(
    '%s: a note is recorded with the actor and nothing else changes',
    async (reason) => {
      const { paymentId, attemptId } = await seedReview(reason, {
        openedAt: clock.now(),
      });
      const before = await attemptRow(attemptId);

      await resolve(paymentId, {
        attemptId,
        actor: 'ops.carol',
        note: 'customer contacted; refund when available',
      }).expect(200);
      await resolve(paymentId, {
        attemptId,
        actor: 'ops.carol',
        note: 'x',
        status: 'FAILED',
      }).expect(409);

      const after = await attemptRow(attemptId);
      expect(after.status).toBe('REQUIRES_REVIEW');
      expect(after.refundRequired).toBe(true);
      expect(after.reviewReason).toBe(before.reviewReason);
      expect((await paymentRow(paymentId)).status).toBe('PENDING');
      expect(await trail(attemptId)).toEqual([
        expect.objectContaining({
          fromStatus: 'REQUIRES_REVIEW',
          toStatus: 'REQUIRES_REVIEW',
          trigger: 'operator_note',
          actor: 'ops.carol',
          reason: 'customer contacted; refund when available',
        }),
      ]);
    },
  );

  it('404 for an unknown Payment or attempt, 409 for an attempt not in review', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
    );
    const body = { actor: 'ops.alice', note: 'n', status: 'FAILED' };

    await resolve(newId(), { ...body, attemptId }).expect(404);
    await resolve(paymentId, { ...body, attemptId: newId() }).expect(404);
    await resolve(paymentId, { ...body, attemptId }).expect(200);
    const again = await resolve(paymentId, { ...body, attemptId }).expect(409);
    expect(again.body.code).toBe('ATTEMPT_NOT_IN_REVIEW');
  });
});
