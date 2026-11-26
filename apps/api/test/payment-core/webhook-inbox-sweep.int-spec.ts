import { GatewayManager } from '../../src/payment-core/application/gateway-manager.js';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { ProcessWebhook } from '../../src/payment-core/application/workers/process-webhook.js';
import {
  Clock,
  FakeClock,
} from '../../src/payment-core/domain/services/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager.module.js';
import { TransactionRunner } from '../../src/payment-core/domain/repositories/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  AlertSink,
  type Alert,
} from '../../src/payment-core/domain/services/alert.js';
import { WebhookInboxProcessor } from '../../src/payment-core/infrastructure/queue/processors/webhook-inbox.processor.js';
import { WebhookInboxSweepProcessor } from '../../src/payment-core/infrastructure/queue/processors/webhook-inbox-sweep.processor.js';
import {
  WEBHOOK_INBOX_LOCK_TIMEOUT_MS,
  WEBHOOK_INBOX_MAX_RETRIES,
  WebhookInboxSweep,
} from '../../src/payment-core/application/sweeps/webhook-inbox-sweep.js';
import {
  WEBHOOK_INBOX_SWEEP_EVERY_MS,
  WEBHOOK_INBOX_SWEEP_JOB,
  WEBHOOK_INBOX_SWEEP_SCHEDULER_ID,
} from '../../src/payment-core/infrastructure/queue/schedulers/webhook-inbox-sweep.scheduler.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 26: the inbox sweep resets lost PROCESSING rows, dispatches RECEIVED
// and FAILED rows, and alerts on rows that used up their retries. Both inbox
// workers are switched off so the test drives the sweep and sees queued jobs.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
const raised: Alert[] = [];
let moduleRef: TestingModule;
let sweep: WebhookInboxSweep;
let worker: ProcessWebhook;
let service: PaymentService;
let fake: FakeGatewayPlugin;
let inboxQueue: Queue;
const extraInstances: TestingModule[] = [];

async function boot(): Promise<TestingModule> {
  const app = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(AlertSink)
    .useValue({ raise: (alert: Alert) => void raised.push(alert) })
    .overrideProvider(WebhookInboxProcessor)
    .useValue({})
    .overrideProvider(WebhookInboxSweepProcessor)
    .useValue({})
    .compile();
  await app.init();
  return app;
}

beforeAll(async () => {
  moduleRef = await boot();
  sweep = moduleRef.get(WebhookInboxSweep);
  worker = moduleRef.get(ProcessWebhook);
  service = moduleRef.get(PaymentService);
  fake = moduleRef
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
  inboxQueue = moduleRef.get<Queue>(getQueueToken(QUEUES.webhookInbox));
});

afterAll(async () => {
  await inboxQueue.obliterate({ force: true });
  await moduleRef
    .get<Queue>(getQueueToken(QUEUES.webhookInboxSweep))
    .obliterate({ force: true });
  while (extraInstances.length > 0) await extraInstances.pop()?.close();
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  raised.length = 0;
  fake.reset();
  await resetDatabase(prisma);
  await inboxQueue.obliterate({ force: true });
});

/** A stored callback naming an attempt Core does not know (always fails). */
async function storeUnprocessable(): Promise<string> {
  const callback = fake.signedCallback({
    status: 'SUCCEEDED',
    amount: '1000',
    attemptKey: newId(),
  });
  const { entry } = await moduleRef
    .get(TransactionRunner)
    .repositories.webhookInbox.record(defaultScope, {
      gatewayId: fake.gatewayId,
      dedupeKey: newId(),
      rawBody: callback.rawBody,
      headers: callback.headers,
      query: callback.query,
    });
  return entry.id;
}

const inboxRow = (id: string) =>
  prisma.webhookInbox.findUniqueOrThrow({ where: { id } });
const queuedIds = async () =>
  (await inboxQueue.getJobs(['waiting', 'delayed', 'active'])).map((j) => j.id);

describe('PROCESSING rows', () => {
  it('resets a row locked more than 5 minutes ago to RECEIVED and dispatches it', async () => {
    const id = await storeUnprocessable();
    await prisma.webhookInbox.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        lockedAt: new Date(NOW.getTime() - WEBHOOK_INBOX_LOCK_TIMEOUT_MS - 1),
      },
    });

    const result = await sweep.run();

    expect(result).toMatchObject({ reset: 1, dispatched: 1 });
    expect(await inboxRow(id)).toMatchObject({
      status: 'RECEIVED',
      lockedAt: null,
      attempts: 1,
    });
    expect(await queuedIds()).toEqual([id]);
  });

  it('does not touch a row locked more recently', async () => {
    const id = await storeUnprocessable();
    const lockedAt = new Date(
      NOW.getTime() - WEBHOOK_INBOX_LOCK_TIMEOUT_MS + 1,
    );
    await prisma.webhookInbox.update({
      where: { id },
      data: { status: 'PROCESSING', attempts: 1, lockedAt },
    });

    const result = await sweep.run();

    expect(result).toMatchObject({ reset: 0, dispatched: 0 });
    expect(await inboxRow(id)).toMatchObject({
      status: 'PROCESSING',
      lockedAt,
    });
    expect(await queuedIds()).toEqual([]);
  });
});

describe('RECEIVED rows', () => {
  it('are dispatched once, with the row id as job id', async () => {
    const id = await storeUnprocessable();

    await sweep.run();
    await sweep.run();

    expect(await queuedIds()).toEqual([id]);
  });

  it('are processed by the worker the sweep dispatched them to', async () => {
    const { payment } = await service.createPayment(defaultScope, {
      amount: '1000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    });
    const { attempt } = await service.startAttempt(defaultScope, {
      paymentId: payment.id,
      gatewayId: fake.gatewayId,
      returnUrl: 'https://shop.example/return',
    });
    const callback = fake.signedCallback({
      status: 'SUCCEEDED',
      amount: '1000',
      attemptKey: attempt.id,
    });
    const { entry } = await moduleRef
      .get(TransactionRunner)
      .repositories.webhookInbox.record(defaultScope, {
        gatewayId: fake.gatewayId,
        dedupeKey: newId(),
        rawBody: callback.rawBody,
        headers: callback.headers,
        query: callback.query,
      });

    await sweep.run();
    const [job] = await inboxQueue.getJobs(['waiting']);
    await worker.execute(job?.data.inboxId);

    expect((await inboxRow(entry.id)).status).toBe('PROCESSED');
  });
});

describe('FAILED rows', () => {
  it('are retried: each try counts in attempts and records the last error', async () => {
    const id = await storeUnprocessable();
    expect(await worker.execute(id)).toBe('failed');
    expect(await inboxRow(id)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
    });

    await sweep.run();
    expect(await queuedIds()).toEqual([id]);
    expect(await worker.execute(id)).toBe('failed');

    expect(await inboxRow(id)).toMatchObject({
      status: 'FAILED',
      attempts: 2,
      lastError: expect.stringContaining('does not know'),
    });
  });

  it('stay FAILED after 5 failed retries and raise an alert', async () => {
    const id = await storeUnprocessable();
    await worker.execute(id); // first try
    for (let retry = 1; retry <= WEBHOOK_INBOX_MAX_RETRIES; retry += 1) {
      await inboxQueue.obliterate({ force: true });
      const result = await sweep.run();
      expect(result).toMatchObject({ dispatched: 1, alerted: 0 });
      await worker.execute(id);
    }
    expect(await inboxRow(id)).toMatchObject({
      status: 'FAILED',
      attempts: WEBHOOK_INBOX_MAX_RETRIES + 1,
    });
    expect(raised).toEqual([]);
    await inboxQueue.obliterate({ force: true });

    const result = await sweep.run();

    expect(result).toMatchObject({ dispatched: 0, alerted: 1 });
    expect(await queuedIds()).toEqual([]);
    expect(await inboxRow(id)).toMatchObject({ status: 'FAILED' });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      code: 'webhook-inbox.exhausted',
      details: {
        inboxId: id,
        attempts: WEBHOOK_INBOX_MAX_RETRIES + 1,
        lastError: expect.stringContaining('does not know'),
      },
    });

    // The next run does not alert again for the same row.
    await sweep.run();
    expect(raised).toHaveLength(1);
  });
});

describe('processing the same row twice', () => {
  it('applies its change once', async () => {
    const { payment } = await service.createPayment(defaultScope, {
      amount: '1000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    });
    const { attempt } = await service.startAttempt(defaultScope, {
      paymentId: payment.id,
      gatewayId: fake.gatewayId,
      returnUrl: 'https://shop.example/return',
    });
    const callback = fake.signedCallback({
      status: 'SUCCEEDED',
      amount: '1000',
      attemptKey: attempt.id,
    });
    const { entry } = await moduleRef
      .get(TransactionRunner)
      .repositories.webhookInbox.record(defaultScope, {
        gatewayId: fake.gatewayId,
        dedupeKey: newId(),
        rawBody: callback.rawBody,
        headers: callback.headers,
        query: callback.query,
      });

    // Two workers race for the same row: one claims it, the other skips.
    const results = await Promise.all([
      worker.execute(entry.id),
      worker.execute(entry.id),
    ]);
    expect([...results].sort()).toEqual(['processed', 'skipped']);

    // A lost lock resets the row after the change was applied: running it
    // again changes nothing.
    await prisma.webhookInbox.update({
      where: { id: entry.id },
      data: { status: 'RECEIVED', processedAt: null },
    });
    expect(await worker.execute(entry.id)).toBe('processed');

    const succeeded = await prisma.outboxEvent.count({
      where: { paymentId: payment.id, eventType: 'PaymentSucceeded' },
    });
    expect(succeeded).toBe(1);
    expect(
      await prisma.statusTransition.count({
        where: { entityId: payment.id, toStatus: 'SUCCEEDED' },
      }),
    ).toBe(1);
  });
});

describe('the schedule', () => {
  it('is one every-minute schedule however many instances boot', async () => {
    extraInstances.push(await boot(), await boot());

    const schedulers = await moduleRef
      .get<Queue>(getQueueToken(QUEUES.webhookInboxSweep))
      .getJobSchedulers();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: WEBHOOK_INBOX_SWEEP_SCHEDULER_ID,
      name: WEBHOOK_INBOX_SWEEP_JOB,
      every: WEBHOOK_INBOX_SWEEP_EVERY_MS,
    });
  });
});
