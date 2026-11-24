import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { Clock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';

// PaymentCoreModule wires the runner, the clock and the queues for later
// tickets' use cases.

let moduleRef: TestingModule;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, PrismaModule, PaymentCoreModule],
  }).compile();
  await moduleRef.init();
});

afterAll(async () => {
  await moduleRef.close();
});

it('provides a transaction runner on the configured database', async () => {
  const runner = moduleRef.get(TransactionRunner);
  const id = newId();

  await runner.run((repos) =>
    repos.payments.create({
      id,
      merchantOrderId: `order-${id}`,
      amount: '1000',
      currency: 'VND',
      status: 'PENDING',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    }),
  );

  expect((await runner.repositories.payments.findById(id))?.id).toBe(id);
});

it('provides the system clock and the Core queues', () => {
  const now = moduleRef.get(Clock).now();
  expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(1000);
  expect(moduleRef.get(getQueueToken(QUEUES.outbox))).toBeDefined();
});
