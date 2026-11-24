import { newId } from '../../src/payment-core/domain/ids.js';
import type { NewPayment } from '../../src/payment-core/domain/payment.js';
import { PrismaTransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// The transaction runner and the repositories it hands out, against the
// migrated test database.

const prisma = createTestPrismaClient();
const runner = new PrismaTransactionRunner(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

function newPayment(overrides: Partial<NewPayment> = {}): NewPayment {
  return {
    id: newId(),
    merchantOrderId: `order-${newId()}`,
    amount: '150000',
    currency: 'VND',
    status: 'PENDING',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function givenPayment(overrides: Partial<NewPayment> = {}) {
  return runner.run((repos) => repos.payments.create(newPayment(overrides)));
}

class Rollback extends Error {}

/** Runs `work` in a transaction that is then rolled back on purpose. */
async function runAndRollBack(work: (repos: Repositories) => Promise<unknown>) {
  await expect(
    runner.run(async (repos) => {
      await work(repos);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe('PaymentRepository', () => {
  it('returns the Payment as a domain object with its attempts, oldest first', async () => {
    const payment = await givenPayment({ amount: '150000' });
    const first = newId();
    const second = newId();
    await runner.run(async (repos) => {
      await repos.payments.createAttempt({
        id: first,
        paymentId: payment.id,
        gatewayId: 'fake',
        status: 'CREATED',
      });
      await repos.payments.updateAttempt(first, { status: 'FAILED' });
      await repos.payments.createAttempt({
        id: second,
        paymentId: payment.id,
        gatewayId: 'fake',
        status: 'PENDING',
        providerRef: 'prov-1',
        providerMetadata: { token: 'abc' },
        nextAction: { type: 'REDIRECT', url: 'https://pay.example/1' },
      });
    });

    const found = await runner.repositories.payments.findById(payment.id);

    expect(found).toMatchObject({
      id: payment.id,
      merchantOrderId: payment.merchantOrderId,
      amount: '150000',
      currency: 'VND',
      status: 'PENDING',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.attempts.map((a) => [a.id, a.status])).toEqual([
      [first, 'FAILED'],
      [second, 'PENDING'],
    ]);
    expect(found?.attempts[1]).toMatchObject({
      gatewayId: 'fake',
      providerRef: 'prov-1',
      providerMetadata: { token: 'abc' },
      nextAction: { type: 'REDIRECT', url: 'https://pay.example/1' },
      reviewReason: null,
      reviewOpenedAt: null,
      refundRequired: false,
    });
  });

  it('keeps fractional amounts as exact decimal strings', async () => {
    const payment = await givenPayment({ amount: '0.0001' });
    const found = await runner.repositories.payments.findById(payment.id);
    expect(found?.amount).toBe('0.0001');
  });

  it('returns null for an unknown Payment', async () => {
    expect(await runner.repositories.payments.findById(newId())).toBeNull();
    expect(
      await runner.run((repos) => repos.payments.findForUpdate(newId())),
    ).toBeNull();
  });

  it('updates the Payment status', async () => {
    const payment = await givenPayment();
    const updated = await runner.run((repos) =>
      repos.payments.update(payment.id, { status: 'CANCELLED' }),
    );
    expect(updated.status).toBe('CANCELLED');
    expect(
      (await runner.repositories.payments.findById(payment.id))?.status,
    ).toBe('CANCELLED');
  });

  it('refuses findForUpdate outside a transaction', async () => {
    const payment = await givenPayment();
    await expect(
      runner.repositories.payments.findForUpdate(payment.id),
    ).rejects.toThrow(/transaction/);
  });

  it('findForUpdate makes a second locker wait until the first commits', async () => {
    const payment = await givenPayment();
    const events: string[] = [];

    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((r) => (releaseFirst = r));
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((r) => (firstLocked = r));

    const first = runner.run(async (repos) => {
      await repos.payments.findForUpdate(payment.id);
      events.push('first locked');
      firstLocked();
      await firstMayCommit;
      await repos.payments.update(payment.id, { status: 'CANCELLED' });
      events.push('first commits');
    });

    await firstHasLock;
    let secondSaw: string | undefined;
    const second = runner.run(async (repos) => {
      const locked = await repos.payments.findForUpdate(payment.id);
      events.push('second locked');
      secondSaw = locked?.status;
    });

    // Give the second locker time to reach the database and block.
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual(['first locked']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(['first locked', 'first commits', 'second locked']);
    expect(secondSaw).toBe('CANCELLED');
  });

  it('rolls back every write of a failed transaction', async () => {
    const payment = newPayment();
    await runAndRollBack((repos) => repos.payments.create(payment));
    expect(await runner.repositories.payments.findById(payment.id)).toBeNull();
  });
});
