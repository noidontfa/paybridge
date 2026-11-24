import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { RequeryAttempt } from '../../src/payment-core/application/workers/requery-attempt.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 20: the browser return writes nothing and queues a status query; the
// status query applies the provider answer through the shared outcome rules.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();

/** Stand-in for the BullMQ queue: records adds. */
class RecordingQueue {
  /** Read by @nestjs/bullmq to build the worker on the real (empty) queue. */
  get opts() {
    return {
      connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null },
      prefix: process.env.QUEUE_PREFIX,
    };
  }
  readonly added: { name: string; data: unknown; jobId?: string }[] = [];
  fail = false;
  add(name: string, data: unknown, opts?: { jobId?: string }): Promise<void> {
    if (this.fail) return Promise.reject(new Error('redis down'));
    this.added.push({ name, data, jobId: opts?.jobId });
    return Promise.resolve();
  }
}
const queue = new RecordingQueue();

let app: INestApplication;
let service: PaymentService;
let requery: RequeryAttempt;
let fake: FakeGatewayPlugin;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new FakeClock(NOW))
    .overrideProvider(getQueueToken(QUEUES.attemptStatusQuery))
    .useValue(queue)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
  service = moduleRef.get(PaymentService);
  requery = moduleRef.get(RequeryAttempt);
  fake = moduleRef.get(FakeGatewayPlugin, { strict: false });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  fake.reset();
  queue.added.length = 0;
  queue.fail = false;
  await resetDatabase(prisma);
});

async function pendingAttempt() {
  const { payment } = await service.createPayment({
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  const { attempt } = await service.startAttempt({
    paymentId: payment.id,
    gatewayId: fake.gatewayId,
    returnUrl: 'https://shop.example/return',
  });
  return { paymentId: payment.id, attemptId: attempt.id };
}

const returnUrl = (paymentId: string) => `/api/payments/${paymentId}/return`;
const attemptRow = (id: string) =>
  prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id } });

async function snapshot() {
  const [payments, attempts, transitions, outbox, raw, inbox] =
    await Promise.all([
      prisma.payment.findMany({ orderBy: { id: 'asc' } }),
      prisma.paymentTransaction.findMany({ orderBy: { id: 'asc' } }),
      prisma.statusTransition.count(),
      prisma.outboxEvent.count(),
      prisma.gatewayRawResponse.count(),
      prisma.webhookInbox.count(),
    ]);
  return { payments, attempts, transitions, outbox, raw, inbox };
}

describe('GET /api/payments/:id/return', () => {
  it('shows the stored PENDING state, writes nothing and queues one status query', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    const before = await snapshot();

    // Provider parameters claiming success must not matter.
    const res = await request(app.getHttpServer())
      .get(`${returnUrl(paymentId)}?vnp_ResponseCode=00&status=SUCCEEDED`)
      .expect(200);

    expect(res.body.status).toBe('PENDING');
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0]).toMatchObject({
      id: attemptId,
      status: 'PENDING',
    });
    expect(await snapshot()).toEqual(before);
    expect(queue.added).toEqual([
      {
        name: 'query-attempt',
        data: { attemptId },
        jobId: attemptId,
      },
    ]);
    expect(fake.calls.query).toHaveLength(0);
  });

  it('never sets the attempt to SUCCEEDED or FAILED', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    await request(app.getHttpServer())
      .get(`${returnUrl(paymentId)}?attemptId=${attemptId}&status=FAILED`)
      .expect(200);
    expect((await attemptRow(attemptId)).status).toBe('PENDING');
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
  });

  it('queues nothing when the attempt is already final, and shows the stored state', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    await prisma.paymentTransaction.update({
      where: { id: attemptId },
      data: { status: 'FAILED' },
    });
    const res = await request(app.getHttpServer())
      .get(returnUrl(paymentId))
      .expect(200);
    expect(res.body.attempts[0].status).toBe('FAILED');
    expect(queue.added).toHaveLength(0);
  });

  it('still shows the Payment when the queue is down', async () => {
    const { paymentId } = await pendingAttempt();
    queue.fail = true;
    const res = await request(app.getHttpServer())
      .get(returnUrl(paymentId))
      .expect(200);
    expect(res.body.status).toBe('PENDING');
  });

  it('404 for an unknown Payment', async () => {
    await request(app.getHttpServer()).get(returnUrl(newId())).expect(404);
  });
});

describe('status query (RequeryAttempt)', () => {
  it('applies a success with the Payment amount', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    fake.scriptQuery({
      status: 'SUCCEEDED',
      amount: '150000',
      providerRef: 'prov-9',
      rawPayload: { ok: true },
    });

    expect(await requery.execute(attemptId)).toBe('applied');

    expect(await attemptRow(attemptId)).toMatchObject({
      status: 'SUCCEEDED',
      providerRef: 'prov-9',
    });
    expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
    const trail = await prisma.statusTransition.findMany({
      where: { entityId: attemptId },
    });
    expect(trail.map((t) => t.trigger)).toContain('status_query');
    const raw = await prisma.gatewayRawResponse.findMany({
      where: { attemptId, operation: 'query' },
    });
    expect(raw).toHaveLength(1);
  });

  it('applies a clear failure to the attempt only', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    fake.scriptQuery({ status: 'FAILED', amount: null, rawPayload: {} });
    await requery.execute(attemptId);
    expect((await attemptRow(attemptId)).status).toBe('FAILED');
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
  });

  it('pending answer changes nothing', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    const before = await snapshot();
    fake.scriptQuery({ status: 'PENDING', amount: null, rawPayload: {} });
    expect(await requery.execute(attemptId)).toBe('applied');
    const after = await snapshot();
    expect(after.attempts).toEqual(before.attempts);
    expect(after.payments).toEqual(before.payments);
    expect(after.transitions).toBe(before.transitions);
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
  });

  it('opens a review when the amount differs', async () => {
    const { attemptId } = await pendingAttempt();
    fake.scriptQuery({ status: 'SUCCEEDED', amount: '1', rawPayload: {} });
    await requery.execute(attemptId);
    expect(await attemptRow(attemptId)).toMatchObject({
      status: 'REQUIRES_REVIEW',
      reviewReason: 'AMOUNT_MISMATCH',
    });
  });

  it('repeating the query for the same state does nothing', async () => {
    const { paymentId, attemptId } = await pendingAttempt();
    fake.scriptQuery(
      { status: 'SUCCEEDED', amount: '150000', rawPayload: {} },
      { status: 'SUCCEEDED', amount: '150000', rawPayload: {} },
    );
    await requery.execute(attemptId);
    const before = await snapshot();

    // The attempt is final now: no provider call, no new rows.
    expect(await requery.execute(attemptId)).toBe('skipped');
    const after = await snapshot();
    expect(after.transitions).toBe(before.transitions);
    expect(after.outbox).toBe(before.outbox);
    expect(after.attempts).toEqual(before.attempts);
    expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
    expect(fake.calls.query).toHaveLength(1);
  });

  it('leaves the attempt alone when the provider has no such transaction', async () => {
    const { attemptId } = await pendingAttempt();
    const { GatewayNotFoundError } = await import(
      '../../src/payment-core/port/index.js'
    );
    fake.scriptQuery(new GatewayNotFoundError('no such order'));
    expect(await requery.execute(attemptId)).toBe('not-found');
    expect((await attemptRow(attemptId)).status).toBe('PENDING');
  });

  it('skips an unknown attempt', async () => {
    expect(await requery.execute(newId())).toBe('skipped');
    expect(await requery.execute('not-a-uuid')).toBe('skipped');
  });
});
