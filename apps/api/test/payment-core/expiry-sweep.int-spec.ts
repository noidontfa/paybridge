import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { expiredPendingPaymentsQuery } from '../../src/payment-core/infrastructure/prisma/payment.repository.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { ALL_ORGANIZATIONS } from '../../src/payment-core/domain/organization-scope.js';
import type { PaymentStatus } from '../../src/payment-core/domain/statuses.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  EXPIRE_PAYMENT_JOB,
  EXPIRY_SWEEP_OPTIONS,
  ExpirySweep,
} from '../../src/payment-core/reliability/expiry-sweep.js';
import { ExpirySweepProcessor } from '../../src/payment-core/reliability/processors/expiry-sweep.processor.js';
import { PaymentExpiryProcessor } from '../../src/payment-core/reliability/processors/payment-expiry.processor.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 23: the sweep finds PENDING Payments past their deadline in
// PostgreSQL and queues each one with its id as job id. Both workers are
// switched off here so the test drives the sweep and the queued jobs stay
// visible.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const BATCH_SIZE = 3;
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let sweep: ExpirySweep;
let queue: Queue;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(EXPIRY_SWEEP_OPTIONS)
    .useValue({ batchSize: BATCH_SIZE })
    .overrideProvider(PaymentExpiryProcessor)
    .useValue({})
    .overrideProvider(ExpirySweepProcessor)
    .useValue({})
    .compile();
  await moduleRef.init();
  sweep = moduleRef.get(ExpirySweep);
  queue = moduleRef.get<Queue>(getQueueToken(QUEUES.paymentExpiry));
});

afterAll(async () => {
  await queue.obliterate({ force: true });
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
  await queue.obliterate({ force: true });
});

/** Inserts a Payment directly, with any status and deadline. */
async function payment(
  expiresAt: Date,
  status: PaymentStatus = 'PENDING',
): Promise<string> {
  const id = newId();
  await moduleRef.get(TransactionRunner).run((tx) =>
    tx.payments.create(defaultScope, {
      id,
      merchantOrderId: `order-${id}`,
      amount: '1000',
      currency: 'VND',
      status,
      expiresAt,
    }),
  );
  return id;
}

const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function queuedIds(): Promise<string[]> {
  const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
  return jobs.map((j) => j.id ?? '').sort();
}

describe('ExpirySweep', () => {
  it('queues PENDING Payments whose deadline has passed, and no others', async () => {
    const passed = await payment(minutes(-5));
    const atDeadline = await payment(NOW);
    await payment(minutes(1));
    await payment(minutes(-5), 'SUCCEEDED');
    await payment(minutes(-5), 'CANCELLED');
    await payment(minutes(-5), 'EXPIRED');

    await expect(sweep.run()).resolves.toEqual({ queued: 2 });

    expect(await queuedIds()).toEqual([passed, atDeadline].sort());
  });

  it('uses the Payment id as job id and the expire-payment job', async () => {
    const id = await payment(minutes(-1));

    await sweep.run();

    const job = await queue.getJob(id);
    expect(job?.name).toBe(EXPIRE_PAYMENT_JOB);
    expect(job?.data).toEqual({ paymentId: id });
  });

  it('queues a Payment once however often the sweep runs', async () => {
    const id = await payment(minutes(-1));

    await sweep.run();
    await sweep.run();

    expect(await queuedIds()).toEqual([id]);
  });

  it('queues at most one batch per run, earliest deadline first', async () => {
    const ids = [];
    for (let i = 5; i >= 1; i--) ids.push(await payment(minutes(-i)));

    await expect(sweep.run()).resolves.toEqual({ queued: BATCH_SIZE });

    expect(await queuedIds()).toEqual(ids.slice(0, BATCH_SIZE).sort());
  });

  it('skips Payments with an attempt in review, so they cannot starve newer expired ones', async () => {
    for (let i = 10; i > 10 - BATCH_SIZE; i--) {
      const stuck = await payment(minutes(-i));
      await moduleRef.get(TransactionRunner).run((tx) =>
        tx.payments.createAttempt(defaultScope, {
          id: newId(),
          paymentId: stuck,
          gatewayId: 'fake',
          status: 'REQUIRES_REVIEW',
        }),
      );
    }
    const due = await payment(minutes(-1));

    await expect(sweep.run()).resolves.toEqual({ queued: 1 });

    expect(await queuedIds()).toEqual([due]);
  });

  it('changes no state when Redis is unavailable, and the next run queues the same Payments', async () => {
    const ids = [await payment(minutes(-2)), await payment(minutes(-1))];
    const before = await prisma.payment.findMany({ orderBy: { id: 'asc' } });
    const down = {
      addBulk: () => Promise.reject(new Error('connect ECONNREFUSED')),
    } as unknown as Queue;
    const sweepWithoutRedis = new ExpirySweep(
      moduleRef.get(TransactionRunner),
      clock,
      down,
      { batchSize: BATCH_SIZE },
    );

    await expect(sweepWithoutRedis.run()).rejects.toThrow('ECONNREFUSED');

    expect(await prisma.payment.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await prisma.statusTransition.count()).toBe(0);

    await expect(sweep.run()).resolves.toEqual({ queued: 2 });
    expect(await queuedIds()).toEqual(ids.sort());
  });
});

describe('expiry index', () => {
  it('serves the sweep query from the partial PENDING expiry index', async () => {
    for (let i = 0; i < 20; i++) {
      await payment(minutes(i - 10), i % 2 ? 'PENDING' : 'SUCCEEDED');
    }
    const query = expiredPendingPaymentsQuery(
      ALL_ORGANIZATIONS,
      NOW,
      BATCH_SIZE,
    );

    // A tiny table would be scanned sequentially anyway; switching seq scans
    // off shows whether the index can serve this exact query at all.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>(
        Prisma.sql`EXPLAIN ${query}`,
      );
    });

    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
      'core_payments_pending_expiry_idx',
    );
  });
});
