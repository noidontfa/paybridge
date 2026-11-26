import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { PrismaTransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  RETENTION_EVERY_MS,
  RETENTION_JOB,
  RETENTION_SCHEDULER_ID,
} from '../../src/payment-core/reliability/retention.scheduler.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 27 end to end: one retention schedule across instances, and the
// scheduled run deleting due rows through the worker on the compose Redis.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const runner = new PrismaTransactionRunner(prisma);
const clock = new FakeClock(NOW);
const instances: TestingModule[] = [];

async function bootInstance(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  await moduleRef.init();
  instances.push(moduleRef);
  return moduleRef;
}

function queue(moduleRef: TestingModule): Queue {
  return moduleRef.get<Queue>(getQueueToken(QUEUES.retention));
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterEach(async () => {
  const [first] = instances;
  if (first) await queue(first).obliterate({ force: true });
  while (instances.length > 0) await instances.pop()?.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('retention schedule', () => {
  it('registers one hourly schedule however many instances boot', async () => {
    const a = await bootInstance();
    await bootInstance();
    await bootInstance();

    const schedulers = await queue(a).getJobSchedulers();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: RETENTION_SCHEDULER_ID,
      name: RETENTION_JOB,
      every: RETENTION_EVERY_MS,
    });
  });

  it('deletes due rows from the scheduled run alone', async () => {
    const key = `key-${newId()}`;
    await runner.repositories.idempotencyKeys.create(defaultScope, {
      key,
      requestHash: 'hash',
      responseStatus: 201,
      responseBody: {},
      paymentId: null,
      expiresAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
    });

    // The scheduler's first run starts right after boot.
    await bootInstance();

    await vi.waitFor(
      async () =>
        expect(
          await runner.repositories.idempotencyKeys.find(defaultScope, key),
        ).toBeNull(),
      { timeout: 10_000, interval: 50 },
    );
  });
});
