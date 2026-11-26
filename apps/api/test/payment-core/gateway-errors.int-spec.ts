import { GatewayManager } from '../../src/payment-core/application/gateway-manager.js';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { BestEffortCancel } from '../../src/payment-core/application/best-effort-cancel.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import {
  INITIATE_ATTEMPT_JOB_OPTIONS,
  StartAttempt,
} from '../../src/payment-core/application/use-cases/start-attempt.js';
import { RequeryAttempt } from '../../src/payment-core/application/workers/requery-attempt.js';
import {
  Clock,
  FakeClock,
} from '../../src/payment-core/domain/services/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import {
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  OutcomeUnknownError,
} from '../../src/payment-core/port/index.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 22: each gateway error category has one defined effect on the
// attempt. A provider outage or a timeout never fails a payment.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const RETURN_URL = 'https://shop.example/return';
const prisma = createTestPrismaClient();

/** Stand-in for a BullMQ queue: records adds. */
class RecordingQueue {
  /** Read by @nestjs/bullmq to build the worker on the real (empty) queue. */
  get opts() {
    return {
      connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null },
      prefix: process.env.QUEUE_PREFIX,
    };
  }
  readonly added: {
    name: string;
    data: unknown;
    opts?: { jobId?: string; attempts?: number; delay?: number };
  }[] = [];
  fail = false;
  add(name: string, data: unknown, opts?: object): Promise<void> {
    if (this.fail) return Promise.reject(new Error('redis down'));
    this.added.push({ name, data, opts });
    return Promise.resolve();
  }
}
// The worker side of these two queues is not under test here: record only.
const initiateQueue = new RecordingQueue();
const queryQueue = new RecordingQueue();

let moduleRef: TestingModule;
let service: PaymentService;
let startAttempt: StartAttempt;
let requery: RequeryAttempt;
let cancels: BestEffortCancel;
let fake: FakeGatewayPlugin;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new FakeClock(NOW))
    .overrideProvider(getQueueToken(QUEUES.attemptInitiate))
    .useValue(initiateQueue)
    .overrideProvider(getQueueToken(QUEUES.attemptStatusQuery))
    .useValue(queryQueue)
    .compile();
  await moduleRef.init();
  service = moduleRef.get(PaymentService);
  startAttempt = moduleRef.get(StartAttempt);
  requery = moduleRef.get(RequeryAttempt);
  cancels = moduleRef.get(BestEffortCancel);
  fake = moduleRef
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  fake.reset();
  initiateQueue.added.length = 0;
  initiateQueue.fail = false;
  queryQueue.added.length = 0;
  await resetDatabase(prisma);
});

async function createPayment() {
  const { payment } = await service.createPayment(defaultScope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  return payment;
}

async function start(description?: string) {
  const payment = await createPayment();
  const result = await service.startAttempt(defaultScope, {
    paymentId: payment.id,
    gatewayId: fake.gatewayId,
    returnUrl: RETURN_URL,
    ...(description !== undefined && { description }),
  });
  return { paymentId: payment.id, attempt: result.attempt };
}

const attemptRow = (id: string) =>
  prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
const transitions = (attemptId: string) =>
  prisma.statusTransition.findMany({ where: { entityId: attemptId } });

describe('initiate: GatewayUnavailable', () => {
  it('leaves the attempt CREATED and queues one bounded retry', async () => {
    fake.scriptInitiate(new GatewayUnavailableError('provider down'));

    const { attempt } = await start('Order 7');

    expect(attempt.status).toBe('CREATED');
    expect((await attemptRow(attempt.id)).status).toBe('CREATED');
    // Only the creation row: no status change.
    expect(await transitions(attempt.id)).toHaveLength(1);
    expect(initiateQueue.added).toHaveLength(1);
    expect(initiateQueue.added[0]).toMatchObject({
      name: 'initiate-attempt',
      data: {
        attemptId: attempt.id,
        returnUrl: RETURN_URL,
        description: 'Order 7',
      },
      opts: { jobId: attempt.id, attempts: 5 },
    });
    expect(INITIATE_ATTEMPT_JOB_OPTIONS.attempts).toBeLessThan(10);
    expect(queryQueue.added).toHaveLength(0);
  });

  it('still answers when the queue is down', async () => {
    fake.scriptInitiate(new GatewayUnavailableError('provider down'));
    initiateQueue.fail = true;
    const { attempt } = await start();
    expect(attempt.status).toBe('CREATED');
  });

  it('the retry job records the result once the provider is back', async () => {
    fake.scriptInitiate(new GatewayUnavailableError('provider down'));
    const { attempt } = await start();
    const job = initiateQueue.added[0]!.data as {
      attemptId: string;
      returnUrl: string;
    };

    expect(await startAttempt.retryInitiate(job as never)).toBe('recorded');

    const row = await attemptRow(attempt.id);
    expect(row.status).toBe('PENDING');
    expect(row.nextAction).toMatchObject({ type: 'REDIRECT' });
    // Same attempt key both times.
    expect(fake.calls.initiate.map((c) => c.attemptKey)).toEqual([
      attempt.id,
      attempt.id,
    ]);
    expect(fake.calls.initiate[1]?.returnUrl).toBe(RETURN_URL);
  });

  it('the retry job throws while the provider is down so the queue retries', async () => {
    fake.scriptInitiate(
      new GatewayUnavailableError('down'),
      new GatewayUnavailableError('still down'),
    );
    const { attempt } = await start();
    await expect(
      startAttempt.retryInitiate({
        attemptId: attempt.id,
        returnUrl: RETURN_URL,
      }),
    ).rejects.toBeInstanceOf(GatewayUnavailableError);
    expect((await attemptRow(attempt.id)).status).toBe('CREATED');
  });

  it('the retry job fails the attempt on a rejection', async () => {
    fake.scriptInitiate(
      new GatewayUnavailableError('down'),
      new GatewayRejectedError('bad merchant'),
    );
    const { attempt } = await start();
    await startAttempt.retryInitiate({
      attemptId: attempt.id,
      returnUrl: RETURN_URL,
    });
    expect((await attemptRow(attempt.id)).status).toBe('FAILED');
  });

  it('the retry job skips an attempt that is no longer CREATED', async () => {
    fake.scriptInitiate(new GatewayUnavailableError('down'));
    const { attempt } = await start();
    await prisma.paymentTransaction.update({
      where: { id: attempt.id },
      data: { status: 'CANCELLED' },
    });
    expect(
      await startAttempt.retryInitiate({
        attemptId: attempt.id,
        returnUrl: RETURN_URL,
      }),
    ).toBe('skipped');
    expect(fake.calls.initiate).toHaveLength(1);
  });
});

describe('initiate: OutcomeUnknown', () => {
  it('keeps the attempt, does not fail it, and queues a status query', async () => {
    fake.scriptInitiate(new OutcomeUnknownError('timeout after send'));

    const { paymentId, attempt } = await start();

    expect(attempt.status).toBe('CREATED');
    expect((await attemptRow(attempt.id)).status).toBe('CREATED');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }))
        .status,
    ).toBe('PENDING');
    expect(queryQueue.added).toHaveLength(1);
    expect(queryQueue.added[0]).toMatchObject({
      name: 'query-attempt',
      data: { attemptId: attempt.id },
      opts: { jobId: attempt.id },
    });
    expect(initiateQueue.added).toHaveLength(0);
  });

  it('the query that follows settles a payment the provider did take', async () => {
    fake.scriptInitiate(new OutcomeUnknownError('timeout after send'));
    const { paymentId, attempt } = await start();
    fake.scriptQuery({
      status: 'SUCCEEDED',
      amount: '150000',
      providerRef: 'prov-1',
      rawPayload: {},
    });

    expect(await requery.execute(attempt.id)).toBe('applied');

    expect((await attemptRow(attempt.id)).status).toBe('SUCCEEDED');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }))
        .status,
    ).toBe('SUCCEEDED');
  });
});

describe('initiate: GatewayRejected', () => {
  it('moves the attempt to FAILED and queues nothing', async () => {
    fake.scriptInitiate(new GatewayRejectedError('invalid merchant'));
    const { attempt } = await start();
    expect(attempt.status).toBe('FAILED');
    expect(initiateQueue.added).toHaveLength(0);
    expect(queryQueue.added).toHaveLength(0);
  });
});

describe('query errors', () => {
  async function pending() {
    return (await start()).attempt;
  }

  it.each([
    ['GatewayUnavailable', new GatewayUnavailableError('down')],
    ['OutcomeUnknown', new OutcomeUnknownError('timeout')],
  ])(
    '%s propagates for the queue to retry and leaves the attempt as it is',
    async (_name, error) => {
      const attempt = await pending();
      fake.scriptQuery(error);
      await expect(requery.execute(attempt.id)).rejects.toBe(error);
      expect((await attemptRow(attempt.id)).status).toBe('PENDING');
      expect(await transitions(attempt.id)).toHaveLength(2);
    },
  );

  it('NotFound leaves the attempt as it is (not treated as unpaid)', async () => {
    const attempt = await pending();
    fake.scriptQuery(new GatewayNotFoundError('no such transaction'));
    expect(await requery.execute(attempt.id)).toBe('not-found');
    expect((await attemptRow(attempt.id)).status).toBe('PENDING');
  });

  it('a non-retryable error ends the job without a retry', async () => {
    const attempt = await pending();
    fake.scriptQuery(new GatewayRejectedError('bad request'));
    expect(await requery.execute(attempt.id)).toBe('unchanged');
    expect((await attemptRow(attempt.id)).status).toBe('PENDING');
  });
});

describe('cancel errors', () => {
  it('are logged, never thrown, and not retried', async () => {
    const { attempt } = await start();
    for (const error of [
      new GatewayUnavailableError('down'),
      new OutcomeUnknownError('timeout'),
      new GatewayRejectedError('no'),
    ]) {
      fake.scriptCancel(error);
      await expect(
        cancels.cancel([
          {
            id: attempt.id,
            organizationId: attempt.organizationId,
            gatewayId: attempt.gatewayId,
            providerMetadata: null,
          },
        ]),
      ).resolves.toBeUndefined();
    }
    expect(fake.calls.cancel).toHaveLength(3);
    expect((await attemptRow(attempt.id)).status).toBe('PENDING');
  });
});
