import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import {
  QUEUES,
  jobIds,
} from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { QueueModule } from '../../src/payment-core/infrastructure/queue/queue.module.js';

// The BullMQ connection against the compose Redis. QUEUE_PREFIX is set per
// test database by vitest.config.int.ts, so parallel runs do not collide.

let moduleRef: TestingModule;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, QueueModule],
  }).compile();
  await moduleRef.init();
});

afterAll(async () => {
  for (const name of Object.values(QUEUES)) {
    await queue(name).obliterate({ force: true });
  }
  await moduleRef.close();
});

function queue(name: string): Queue {
  return moduleRef.get<Queue>(getQueueToken(name));
}

describe('QueueModule', () => {
  it('registers every Core queue on the configured Redis and prefix', async () => {
    for (const name of Object.values(QUEUES)) {
      const q = queue(name);
      expect(q.name).toBe(name);
      expect(q.qualifiedName).toBe(`${process.env.QUEUE_PREFIX}:${name}`);
      await expect(q.waitUntilReady()).resolves.toBeUndefined();
    }
  });

  it('enqueues an outbox row once however often it is added (job id = outbox row id)', async () => {
    const q = queue(QUEUES.outbox);
    const outboxRowId = newId();

    const first = await q.add(
      'PaymentCreated',
      { n: 1 },
      {
        jobId: jobIds.outboxEvent(outboxRowId),
      },
    );
    const second = await q.add(
      'PaymentCreated',
      { n: 2 },
      {
        jobId: jobIds.outboxEvent(outboxRowId),
      },
    );

    expect(first.id).toBe(outboxRowId);
    expect(second.id).toBe(outboxRowId);
    const job = await q.getJob(outboxRowId);
    expect(job?.data).toEqual({ n: 1 });
    expect(await q.getJobCountByTypes('waiting', 'delayed', 'active')).toBe(1);
  });

  it('keeps one expiry job per Payment (job id = payment id)', async () => {
    const q = queue(QUEUES.paymentExpiry);
    const paymentId = newId();

    await q.add('expire', {}, { jobId: jobIds.payment(paymentId) });
    await q.add('expire', {}, { jobId: jobIds.payment(paymentId) });

    expect((await q.getJob(paymentId))?.id).toBe(paymentId);
    expect(await q.getJobCountByTypes('waiting', 'delayed', 'active')).toBe(1);
  });

  it('rejects a job id that is not a UUID', () => {
    expect(() => jobIds.payment('a:b')).toThrow(/UUID/);
    expect(() => jobIds.outboxEvent('42')).toThrow(/UUID/);
  });
});
