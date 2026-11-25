import { GatewayManager } from '../../src/payment-core/gateway-manager/gateway-manager.js';
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
import { ProviderQueryRateLimiter } from '../../src/payment-core/reliability/provider-query-rate-limiter.js';
import {
  GatewayNotFoundError,
  GatewayUnavailableError,
  OutcomeUnknownError,
} from '../../src/payment-core/port/index.js';
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
  fake = moduleRef
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
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

  it('expires a Payment whose attempts are all closed, with no provider call', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'FAILED');
    clock.set(DEADLINE);

    await expect(expirePayment.execute(payment.id)).resolves.toBe('expired');

    expect(providerCalls()).toBe(0);
  });
});

async function addAttempt(
  paymentId: string,
  status: 'CREATED' | 'PENDING' | 'FAILED' | 'REQUIRES_REVIEW',
): Promise<string> {
  const id = newId();
  await moduleRef.get(TransactionRunner).run((tx) =>
    tx.payments.createAttempt({
      id,
      paymentId,
      gatewayId: 'fake',
      status,
    }),
  );
  return id;
}

// Ticket 24: a Payment with an open attempt expires only after the provider
// confirms the attempt is unpaid.
describe('ExpirePayment with open attempts', () => {
  it('queries the attempt, then expires Payment and attempt and cancels at the provider', async () => {
    const payment = await createPayment();
    const attemptId = await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);

    await expect(expirePayment.execute(payment.id)).resolves.toBe('expired');

    expect(fake.calls.query.map((c) => c.attemptKey)).toEqual([attemptId]);
    expect(fake.calls.cancel.map((c) => c.attemptKey)).toEqual([attemptId]);
    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('EXPIRED');
    expect(after?.attempts[0]?.status).toBe('EXPIRED');
    expect(
      await repos.statusTransitions.listForEntity(
        'PAYMENT_TRANSACTION',
        attemptId,
      ),
    ).toMatchObject([
      {
        fromStatus: 'PENDING',
        toStatus: 'EXPIRED',
        trigger: 'expiry',
        actor: 'system',
      },
    ]);
    expect(
      (await repos.outbox.listForPayment(payment.id)).map((e) => e.eventType),
    ).toEqual(['PaymentCreated', 'PaymentExpired']);
    expect(
      await repos.gatewayRawResponses.listForAttempt(attemptId),
    ).toMatchObject([{ operation: 'query' }, { operation: 'cancel' }]);
  });

  it('expires a Payment whose open attempt is still CREATED, closing that attempt as CANCELLED', async () => {
    const payment = await createPayment();
    const attemptId = await addAttempt(payment.id, 'CREATED');
    clock.set(DEADLINE);

    await expect(expirePayment.execute(payment.id)).resolves.toBe('expired');

    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('EXPIRED');
    expect(after?.attempts[0]?.status).toBe('CANCELLED');
    expect(
      await repos.statusTransitions.listForEntity(
        'PAYMENT_TRANSACTION',
        attemptId,
      ),
    ).toMatchObject([
      { fromStatus: 'CREATED', toStatus: 'CANCELLED', trigger: 'expiry' },
    ]);
  });

  it('applies a payment confirmed just before the deadline as a success, not an expiry', async () => {
    const payment = await createPayment();
    const attemptId = await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    fake.scriptQuery({
      status: 'SUCCEEDED',
      amount: '150000',
      rawPayload: { paidAt: '2026-05-01T10:29:59Z' },
    });

    await expect(expirePayment.execute(payment.id)).resolves.toBe('succeeded');

    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('SUCCEEDED');
    expect(after?.attempts.find((a) => a.id === attemptId)?.status).toBe(
      'SUCCEEDED',
    );
    expect(
      (await repos.outbox.listForPayment(payment.id)).map((e) => e.eventType),
    ).toEqual(['PaymentCreated', 'PaymentSucceeded']);
  });

  it('sends a paid answer with the wrong amount to review and does not expire', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    fake.scriptQuery({ status: 'SUCCEEDED', amount: '1', rawPayload: {} });

    await expirePayment.execute(payment.id);

    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('PENDING');
    expect(after?.attempts[0]?.status).toBe('REQUIRES_REVIEW');
  });

  it('closes an attempt the provider says failed and expires the Payment', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    fake.scriptQuery({ status: 'FAILED', amount: null, rawPayload: {} });

    await expect(expirePayment.execute(payment.id)).resolves.toBe('expired');

    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('EXPIRED');
    expect(after?.attempts[0]?.status).toBe('FAILED');
  });

  it.each([
    ['a provider outage', new GatewayUnavailableError('down')],
    ['an unknown outcome', new OutcomeUnknownError('timeout')],
    ['no such transaction', new GatewayNotFoundError('missing')],
  ])('leaves the Payment PENDING on %s', async (_name, error) => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    fake.scriptQuery(error);

    await expect(expirePayment.execute(payment.id)).resolves.toBe('unclear');

    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('PENDING');
    expect(after?.attempts[0]?.status).toBe('PENDING');
    expect(await repos.outbox.listForPayment(payment.id)).toHaveLength(1);
  });

  it('leaves a Payment alone when an attempt is under review', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'REQUIRES_REVIEW');
    clock.set(DEADLINE);

    await expect(expirePayment.execute(payment.id)).resolves.toBe('unclear');

    expect(providerCalls()).toBe(0);
    expect((await repos.payments.findById(payment.id))?.status).toBe('PENDING');
  });

  it('holds no transaction open while the provider is queried', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    let lockedDuringQuery = false;
    fake.scriptQuery(async () => {
      // The Payment row lock is free: a NOWAIT lock on it succeeds.
      try {
        await prisma.$transaction(
          (tx) =>
            tx.$queryRaw`SELECT id FROM core_payments WHERE id = ${payment.id}::uuid FOR UPDATE NOWAIT`,
          { timeout: 2000 },
        );
      } catch {
        lockedDuringQuery = true;
      }
      return { status: 'PENDING', amount: null, rawPayload: {} };
    });

    await expirePayment.execute(payment.id);

    expect(lockedDuringQuery).toBe(false);
  });

  it('follows the new state when the Payment changed while the query ran', async () => {
    const payment = await createPayment();
    const attemptId = await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    fake.scriptQuery(async () => {
      await payments.cancelPayment(payment.id);
      return { status: 'PENDING', amount: null, rawPayload: {} };
    });

    await expect(expirePayment.execute(payment.id)).resolves.toBe(
      'not-pending',
    );

    const after = await repos.payments.findById(payment.id);
    expect(after?.status).toBe('CANCELLED');
    expect(after?.attempts.find((a) => a.id === attemptId)?.status).toBe(
      'CANCELLED',
    );
    expect(
      (await repos.outbox.listForPayment(payment.id)).map((e) => e.eventType),
    ).not.toContain('PaymentExpired');
  });

  it('does not expire when a new attempt appeared while the query ran', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    fake.scriptQuery(async () => {
      await moduleRef.get(TransactionRunner).run(async (tx) => {
        // Simulate a gateway switch: old attempt cancelled, new one open.
        const locked = await tx.payments.findForUpdate(payment.id);
        await tx.payments.updateAttempt(locked!.attempts[0]!.id, {
          status: 'CANCELLED',
        });
        await tx.payments.createAttempt({
          id: newId(),
          paymentId: payment.id,
          gatewayId: 'fake',
          status: 'PENDING',
        });
      });
      return { status: 'PENDING', amount: null, rawPayload: {} };
    });

    await expect(expirePayment.execute(payment.id)).resolves.toBe('unclear');

    expect((await repos.payments.findById(payment.id))?.status).toBe('PENDING');
  });

  it('asks the rate limiter before every provider query', async () => {
    const payment = await createPayment();
    await addAttempt(payment.id, 'PENDING');
    clock.set(DEADLINE);
    const acquire = vi.spyOn(
      moduleRef.get(ProviderQueryRateLimiter),
      'acquire',
    );

    await expirePayment.execute(payment.id);

    expect(acquire).toHaveBeenCalledTimes(1);
    acquire.mockRestore();
  });
});
