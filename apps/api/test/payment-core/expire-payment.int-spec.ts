import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { ExpirePayment } from '../../src/payment-core/application/workers/expire-payment.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Payment } from '../../src/payment-core/domain/payment.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 23: the expiry worker closes a PENDING Payment that has no attempt at
// its deadline, without asking any provider. Payments with attempts are left
// for ticket 24.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const DEADLINE = new Date('2026-05-01T10:30:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let expirePayment: ExpirePayment;
let payments: PaymentService;
let repos: Repositories;
let fake: FakeGatewayPlugin;

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
    .compile();
  await moduleRef.init();
  expirePayment = moduleRef.get(ExpirePayment);
  payments = moduleRef.get(PaymentService);
  repos = moduleRef.get(TransactionRunner).repositories;
  fake = moduleRef.get(FakeGatewayPlugin);
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  fake.reset();
  await resetDatabase(prisma);
});

async function createPayment(): Promise<Payment> {
  const { payment } = await payments.createPayment({
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  return payment;
}

function providerCalls(): number {
  return Object.values(fake.calls).reduce((n, list) => n + list.length, 0);
}

describe('ExpirePayment', () => {
  it('expires a PENDING Payment with no attempt at its deadline, with no provider call', async () => {
    const payment = await createPayment();
    clock.set(DEADLINE);

    await expect(expirePayment.execute(payment.id)).resolves.toBe('expired');

    expect((await repos.payments.findById(payment.id))?.status).toBe('EXPIRED');
    expect(providerCalls()).toBe(0);
  });

  it('writes the status transition and the PaymentExpired event', async () => {
    const payment = await createPayment();
    clock.set(DEADLINE);

    await expirePayment.execute(payment.id);

    expect(
      await repos.statusTransitions.listForEntity('PAYMENT', payment.id),
    ).toMatchObject([
      { fromStatus: null, toStatus: 'PENDING' },
      {
        fromStatus: 'PENDING',
        toStatus: 'EXPIRED',
        trigger: 'expiry',
        actor: 'system',
      },
    ]);
    const events = await repos.outbox.listForPayment(payment.id);
    expect(events.map((e) => e.eventType)).toEqual([
      'PaymentCreated',
      'PaymentExpired',
    ]);
    expect(events[1]?.payload).toEqual({
      paymentId: payment.id,
      upstreamReference: payment.merchantOrderId,
      amount: '150000',
      currency: 'VND',
      status: 'EXPIRED',
      expiresAt: '2026-05-01T10:30:00.000Z',
    });
  });

  it('leaves a Payment alone before its deadline', async () => {
    const payment = await createPayment();
    clock.set(new Date(DEADLINE.getTime() - 1));

    await expect(expirePayment.execute(payment.id)).resolves.toBe('not-due');

    expect((await repos.payments.findById(payment.id))?.status).toBe('PENDING');
    expect(await repos.outbox.listForPayment(payment.id)).toHaveLength(1);
  });

  it('does nothing for a Payment that is no longer PENDING', async () => {
    const payment = await createPayment();
    clock.set(DEADLINE);
    await expirePayment.execute(payment.id);

    await expect(expirePayment.execute(payment.id)).resolves.toBe(
      'not-pending',
    );

    expect(await repos.outbox.listForPayment(payment.id)).toHaveLength(2);
    expect(
      await repos.statusTransitions.listForEntity('PAYMENT', payment.id),
    ).toHaveLength(2);
  });

  it('does nothing for an unknown Payment', async () => {
    await expect(expirePayment.execute(newId())).resolves.toBe('not-found');
  });

  it('hands a Payment with an attempt to the attempt expiry and does not close it', async () => {
    const payment = await createPayment();
    await moduleRef.get(TransactionRunner).run((tx) =>
      tx.payments.createAttempt({
        id: newId(),
        paymentId: payment.id,
        gatewayId: 'fake',
        status: 'PENDING',
      }),
    );
    clock.set(DEADLINE);

    await expect(expirePayment.execute(payment.id)).resolves.toBe(
      'has-attempts',
    );

    expect((await repos.payments.findById(payment.id))?.status).toBe('PENDING');
    expect(await repos.outbox.listForPayment(payment.id)).toHaveLength(1);
    expect(providerCalls()).toBe(0);
  });
});
