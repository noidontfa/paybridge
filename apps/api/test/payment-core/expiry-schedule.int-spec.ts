import { GatewayManager } from '../../src/payment-core/application/gateway-manager.js';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import {
  Clock,
  FakeClock,
} from '../../src/payment-core/domain/services/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager.module.js';
import { PrismaTransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { ExpirySweep } from '../../src/payment-core/application/sweeps/expiry-sweep.js';
import {
  EXPIRY_SWEEP_EVERY_MS,
  EXPIRY_SWEEP_JOB,
  EXPIRY_SWEEP_SCHEDULER_ID,
} from '../../src/payment-core/infrastructure/queue/schedulers/expiry-sweep.scheduler.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 23 end to end: the schedule registered at boot, the sweep and the
// expiry worker running on the compose Redis, with a fake clock.

const CREATED = new Date('2026-05-01T10:00:00.000Z');
const DEADLINE = new Date('2026-05-01T10:30:00.000Z');
const prisma = createTestPrismaClient();
const runner = new PrismaTransactionRunner(prisma);
const clock = new FakeClock(CREATED);
const instances: TestingModule[] = [];

/** Boots one application instance (Core with its workers and scheduler). */
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

function queue(moduleRef: TestingModule, name: string): Queue {
  return moduleRef.get<Queue>(getQueueToken(name));
}

async function createPendingPayment(): Promise<string> {
  const id = newId();
  await runner.run((tx) =>
    tx.payments.create(defaultScope, {
      id,
      merchantOrderId: `order-${id}`,
      amount: '1000',
      currency: 'VND',
      status: 'PENDING',
      expiresAt: DEADLINE,
    }),
  );
  return id;
}

async function statusOf(id: string): Promise<string | undefined> {
  return (await runner.repositories.payments.findById(defaultScope, id))
    ?.status;
}

/** Waits until the expiry queue has no job left to run. */
async function drained(moduleRef: TestingModule): Promise<void> {
  const q = queue(moduleRef, QUEUES.paymentExpiry);
  await vi.waitFor(
    async () => {
      expect(await q.getJobCountByTypes('waiting', 'delayed', 'active')).toBe(
        0,
      );
    },
    { timeout: 10_000, interval: 50 },
  );
}

beforeEach(async () => {
  clock.set(CREATED);
  await resetDatabase(prisma);
});

afterEach(async () => {
  const [first] = instances;
  if (first) {
    for (const name of [QUEUES.expirySweep, QUEUES.paymentExpiry]) {
      await queue(first, name).obliterate({ force: true });
    }
  }
  while (instances.length > 0) await instances.pop()?.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('expiry sweep schedule', () => {
  it('registers one every-minute schedule however many instances boot', async () => {
    const a = await bootInstance();
    await bootInstance();
    await bootInstance();

    const schedulers = await queue(a, QUEUES.expirySweep).getJobSchedulers();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: EXPIRY_SWEEP_SCHEDULER_ID,
      name: EXPIRY_SWEEP_JOB,
      every: EXPIRY_SWEEP_EVERY_MS,
    });
  });

  it('closes a Payment with no attempt within one sweep interval after its deadline, without a provider call', async () => {
    const id = await createPendingPayment();
    const app = await bootInstance();
    const sweep = app.get(ExpirySweep);
    const fake = app
      .get(GatewayManager, { strict: false })
      .resolve('fake') as FakeGatewayPlugin;

    // The last sweep before the deadline leaves it alone.
    clock.set(new Date(DEADLINE.getTime() - 1));
    await sweep.run();
    await drained(app);
    expect(await statusOf(id)).toBe('PENDING');

    // The next sweep runs at most one interval later and closes it.
    clock.set(new Date(DEADLINE.getTime() - 1 + EXPIRY_SWEEP_EVERY_MS));
    await sweep.run();
    await vi.waitFor(async () => expect(await statusOf(id)).toBe('EXPIRED'), {
      timeout: 10_000,
      interval: 50,
    });
    expect(Object.values(fake.calls).flat()).toHaveLength(0);
  });

  it('expires an overdue Payment from the scheduled sweep alone', async () => {
    const id = await createPendingPayment();
    clock.set(new Date(DEADLINE.getTime() + 30_000));

    // The scheduler's first sweep runs right after boot.
    await bootInstance();

    await vi.waitFor(async () => expect(await statusOf(id)).toBe('EXPIRED'), {
      timeout: 10_000,
      interval: 50,
    });
  });
});
