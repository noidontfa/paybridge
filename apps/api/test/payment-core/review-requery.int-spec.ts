import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { RequeryAttempt } from '../../src/payment-core/application/workers/requery-attempt.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { ReviewReason } from '../../src/payment-core/domain/statuses.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { ReviewRequerySweep } from '../../src/payment-core/reliability/review-requery-sweep.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 28: attempts in review for AMBIGUOUS_PROVIDER_STATUS or
// AMOUNT_MISMATCH are re-queried on a schedule, for 72 hours.

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);

/** Stand-in for the review queue: records adds; real worker sees no jobs. */
class RecordingQueue {
  get opts() {
    return {
      connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null },
      prefix: process.env.QUEUE_PREFIX,
    };
  }
  readonly added: {
    name: string;
    data: { attemptId: string };
    jobId?: string;
  }[] = [];
  addBulk(
    jobs: {
      name: string;
      data: { attemptId: string };
      opts?: { jobId?: string };
    }[],
  ): Promise<void> {
    for (const job of jobs) {
      this.added.push({
        name: job.name,
        data: job.data,
        jobId: job.opts?.jobId,
      });
    }
    return Promise.resolve();
  }
}
const queue = new RecordingQueue();

let moduleRef: TestingModule;
let service: PaymentService;
let requery: RequeryAttempt;
let sweep: ReviewRequerySweep;
let runner: TransactionRunner;
let fake: FakeGatewayPlugin;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(getQueueToken(QUEUES.reviewRequery))
    .useValue(queue)
    .compile();
  await moduleRef.init();
  service = moduleRef.get(PaymentService);
  requery = moduleRef.get(RequeryAttempt);
  sweep = moduleRef.get(ReviewRequerySweep);
  runner = moduleRef.get(TransactionRunner);
  fake = moduleRef.get(FakeGatewayPlugin, { strict: false });
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  fake.reset();
  queue.added.length = 0;
  await resetDatabase(prisma);
});

/** A PENDING Payment whose only attempt is in review since `openedAt`. */
async function seedReview(
  reason: ReviewReason,
  openedAt: Date = NOW,
  options: { payment?: 'SUCCEEDED' } = {},
) {
  const { payment } = await service.createPayment(defaultScope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  const attemptId = newId();
  await runner.run(async (tx) => {
    await tx.payments.createAttempt(defaultScope, {
      id: attemptId,
      paymentId: payment.id,
      gatewayId: fake.gatewayId,
      status: 'REQUIRES_REVIEW',
    });
    await tx.payments.updateAttempt(defaultScope, attemptId, {
      reviewReason: reason,
      reviewOpenedAt: openedAt,
      refundRequired: true,
    });
    if (options.payment) {
      await tx.payments.update(defaultScope, payment.id, {
        status: options.payment,
      });
    }
  });
  return { paymentId: payment.id, attemptId };
}

const attemptRow = (id: string) =>
  prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id } });

const succeeded = (amount: string | null = '150000') => ({
  status: 'SUCCEEDED' as const,
  amount,
  rawPayload: { fake: 'query' },
});
const failed = {
  status: 'FAILED' as const,
  amount: null,
  rawPayload: { fake: 'query' },
};

describe('review re-query sweep', () => {
  it('queues only AMBIGUOUS_PROVIDER_STATUS and AMOUNT_MISMATCH reviews inside 72 hours', async () => {
    const ambiguous = await seedReview('AMBIGUOUS_PROVIDER_STATUS');
    const mismatch = await seedReview(
      'AMOUNT_MISMATCH',
      new Date(NOW.getTime() - 71 * HOUR),
    );
    await seedReview('LATE_SUCCESS_ON_CLOSED_PAYMENT');
    await seedReview('DUPLICATE_SUCCESS');
    await seedReview('AMOUNT_MISMATCH', new Date(NOW.getTime() - 72 * HOUR));

    expect(await sweep.run()).toEqual({ queued: 2 });
    expect(new Set(queue.added.map((j) => j.jobId))).toEqual(
      new Set([ambiguous.attemptId, mismatch.attemptId]),
    );
    expect(queue.added.every((j) => j.name === 'requery-review')).toBe(true);
  });

  it('stops queueing an attempt once its review is 72 hours old (fake clock)', async () => {
    const { attemptId } = await seedReview('AMBIGUOUS_PROVIDER_STATUS');

    clock.set(new Date(NOW.getTime() + 72 * HOUR - 1));
    expect(await sweep.run()).toEqual({ queued: 1 });

    queue.added.length = 0;
    clock.set(new Date(NOW.getTime() + 72 * HOUR));
    expect(await sweep.run()).toEqual({ queued: 0 });
    expect(await requery.executeReview(attemptId)).toBe('skipped');
    expect(fake.calls.query).toHaveLength(0);
    // Left for an operator, still in review, nothing written.
    expect((await attemptRow(attemptId)).status).toBe('REQUIRES_REVIEW');
  });
});

describe('RequeryAttempt.executeReview', () => {
  it.each(['AMBIGUOUS_PROVIDER_STATUS', 'AMOUNT_MISMATCH'] as const)(
    'a clear success with the right amount promotes the Payment (%s)',
    async (reason) => {
      const { paymentId, attemptId } = await seedReview(reason);
      fake.scriptQuery(succeeded());

      expect(await requery.executeReview(attemptId)).toBe('applied');

      expect((await attemptRow(attemptId)).status).toBe('SUCCEEDED');
      expect((await attemptRow(attemptId)).refundRequired).toBe(false);
      expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
      expect(
        await prisma.outboxEvent.count({
          where: { paymentId, eventType: 'PaymentSucceeded' },
        }),
      ).toBe(1);
      const transition = await prisma.statusTransition.findFirstOrThrow({
        where: { entityId: attemptId, toStatus: 'SUCCEEDED' },
      });
      expect(transition).toMatchObject({
        fromStatus: 'REQUIRES_REVIEW',
        trigger: 'status_query',
        actor: 'system',
      });
    },
  );

  it('a clear failure moves the attempt to FAILED and leaves the Payment PENDING', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
    );
    fake.scriptQuery(failed);

    expect(await requery.executeReview(attemptId)).toBe('applied');

    expect((await attemptRow(attemptId)).status).toBe('FAILED');
    expect((await attemptRow(attemptId)).refundRequired).toBe(false);
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
  });

  it('a still-mismatched amount leaves the review open and is queried again next run', async () => {
    const { paymentId, attemptId } = await seedReview('AMOUNT_MISMATCH');
    fake.scriptQuery(succeeded('149000'), succeeded('150000'));

    await requery.executeReview(attemptId);
    const first = await attemptRow(attemptId);
    expect(first.status).toBe('REQUIRES_REVIEW');
    expect(first.reviewReason).toBe('AMOUNT_MISMATCH');
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
    expect(await sweep.run()).toEqual({ queued: 1 });

    await requery.executeReview(attemptId);
    expect((await attemptRow(attemptId)).status).toBe('SUCCEEDED');
    expect(fake.calls.query).toHaveLength(2);
  });

  it.each([
    ['pending', { status: 'PENDING' as const, amount: null }],
    ['unclear', { status: 'REQUIRES_REVIEW' as const, amount: null }],
  ])('a %s answer leaves the attempt in review', async (_name, answer) => {
    const { attemptId } = await seedReview('AMBIGUOUS_PROVIDER_STATUS');
    fake.scriptQuery({ ...answer, rawPayload: {} });

    await requery.executeReview(attemptId);

    const row = await attemptRow(attemptId);
    expect(row.status).toBe('REQUIRES_REVIEW');
    expect(row.refundRequired).toBe(true);
    expect(await sweep.run()).toEqual({ queued: 1 });
  });

  it.each(['LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS'] as const)(
    'never re-queries a %s review',
    async (reason) => {
      const { attemptId } = await seedReview(reason);
      fake.scriptQuery(succeeded());

      expect(await requery.executeReview(attemptId)).toBe('skipped');

      expect(fake.calls.query).toHaveLength(0);
      expect((await attemptRow(attemptId)).status).toBe('REQUIRES_REVIEW');
    },
  );

  it('does not promote when another attempt already succeeded', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
      NOW,
      { payment: 'SUCCEEDED' },
    );
    fake.scriptQuery(succeeded());

    await requery.executeReview(attemptId);

    expect((await attemptRow(attemptId)).status).toBe('REQUIRES_REVIEW');
    expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
    expect(
      await prisma.outboxEvent.count({
        where: { paymentId, eventType: 'PaymentSucceeded' },
      }),
    ).toBe(0);
  });

  it('queries the provider with no transaction open', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
    );
    let lockable = false;
    fake.scriptQuery(async () => {
      // Fails at once if a transaction holds the Payment row lock.
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM core_payments WHERE id = ${paymentId}::uuid FOR UPDATE NOWAIT`;
        lockable = true;
      });
      return succeeded();
    });

    await requery.executeReview(attemptId);

    expect(lockable).toBe(true);
    expect((await attemptRow(attemptId)).status).toBe('SUCCEEDED');
  });

  it('re-checks the state under the Payment lock before writing', async () => {
    const { paymentId, attemptId } = await seedReview(
      'AMBIGUOUS_PROVIDER_STATUS',
    );
    // An operator closes the review while the provider query is in flight.
    fake.scriptQuery(async () => {
      await prisma.paymentTransaction.update({
        where: { id: attemptId },
        data: { status: 'FAILED' },
      });
      return succeeded();
    });

    expect(await requery.executeReview(attemptId)).toBe('skipped');

    expect((await attemptRow(attemptId)).status).toBe('FAILED');
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
  });
});
