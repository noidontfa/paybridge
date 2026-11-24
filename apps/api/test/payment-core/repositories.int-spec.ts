import { newId } from '../../src/payment-core/domain/ids.js';
import { PrismaTransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// The per-table repositories, through the transaction runner.

const prisma = createTestPrismaClient();
const runner = new PrismaTransactionRunner(prisma);
const repos = runner.repositories;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function givenPayment() {
  return runner.run((r) =>
    r.payments.create({
      id: newId(),
      merchantOrderId: `order-${newId()}`,
      amount: '50000',
      currency: 'VND',
      status: 'PENDING',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    }),
  );
}

async function givenAttempt(paymentId: string) {
  return runner.run((r) =>
    r.payments.createAttempt({
      id: newId(),
      paymentId,
      gatewayId: 'fake',
      status: 'PENDING',
    }),
  );
}

class Rollback extends Error {}

async function runAndRollBack(work: (r: Repositories) => Promise<unknown>) {
  await expect(
    runner.run(async (r) => {
      await work(r);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe('StatusTransitionRepository', () => {
  it('records entity, from, to, trigger, actor and reason with the change it describes', async () => {
    const payment = await givenPayment();

    await runner.run(async (r) => {
      await r.payments.update(payment.id, { status: 'CANCELLED' });
      await r.statusTransitions.record({
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        trigger: 'merchant_cancel',
        actor: 'merchant',
        reason: 'customer changed their mind',
      });
    });

    const trail = await repos.statusTransitions.listForEntity(
      'PAYMENT',
      payment.id,
    );
    expect(trail).toEqual([
      {
        id: expect.any(String),
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        trigger: 'merchant_cancel',
        actor: 'merchant',
        reason: 'customer changed their mind',
        createdAt: expect.any(Date),
      },
    ]);
  });

  it('records a creation with no from-status and no reason', async () => {
    const payment = await givenPayment();
    await runner.run((r) =>
      r.statusTransitions.record({
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: null,
        toStatus: 'PENDING',
        trigger: 'create_payment',
        actor: 'merchant',
      }),
    );
    const [entry] = await repos.statusTransitions.listForEntity(
      'PAYMENT',
      payment.id,
    );
    expect(entry).toMatchObject({ fromStatus: null, reason: null });
  });

  it('rolls back with the change it records', async () => {
    const payment = await givenPayment();

    await runAndRollBack(async (r) => {
      await r.payments.update(payment.id, { status: 'CANCELLED' });
      await r.statusTransitions.record({
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        trigger: 'merchant_cancel',
        actor: 'merchant',
      });
    });

    expect((await repos.payments.findById(payment.id))?.status).toBe('PENDING');
    expect(
      await repos.statusTransitions.listForEntity('PAYMENT', payment.id),
    ).toEqual([]);
  });
});

describe('OutboxRepository', () => {
  it('writes an event with a UUID v7 id, unpublished, committed with the state change', async () => {
    const payment = await givenPayment();

    const event = await runner.run(async (r) => {
      await r.payments.update(payment.id, { status: 'CANCELLED' });
      return r.outbox.add({
        eventType: 'PaymentCancelled',
        paymentId: payment.id,
        payload: { paymentId: payment.id, status: 'CANCELLED' },
      });
    });

    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await repos.outbox.listForPayment(payment.id)).toEqual([
      {
        id: event.id,
        eventType: 'PaymentCancelled',
        paymentId: payment.id,
        payload: { paymentId: payment.id, status: 'CANCELLED' },
        createdAt: expect.any(Date),
        publishedAt: null,
      },
    ]);
  });

  it('leaves no outbox row when the state change rolls back', async () => {
    const payment = await givenPayment();

    await runAndRollBack(async (r) => {
      await r.payments.update(payment.id, { status: 'CANCELLED' });
      await r.outbox.add({
        eventType: 'PaymentCancelled',
        paymentId: payment.id,
        payload: {},
      });
    });

    expect(await repos.outbox.listForPayment(payment.id)).toEqual([]);
    expect((await repos.payments.findById(payment.id))?.status).toBe('PENDING');
  });
});

describe('WebhookInboxRepository', () => {
  const callback = (dedupeKey: string) => ({
    gatewayId: 'fake',
    dedupeKey,
    providerEventId: dedupeKey,
    attemptKey: newId(),
    rawBody: new TextEncoder().encode('{"ok":true}'),
    headers: { 'x-signature': 'abc' },
    query: {},
  });

  it('stores a callback as RECEIVED and finds it by id', async () => {
    const { entry, duplicate } = await repos.webhookInbox.record(
      callback('evt-1'),
    );

    expect(duplicate).toBe(false);
    const found = await repos.webhookInbox.findById(entry.id);
    expect(found).toMatchObject({
      gatewayId: 'fake',
      dedupeKey: 'evt-1',
      providerEventId: 'evt-1',
      status: 'RECEIVED',
      attempts: 0,
      lockedAt: null,
      lastError: null,
      processedAt: null,
      headers: { 'x-signature': 'abc' },
      query: {},
    });
    expect(new TextDecoder().decode(found?.rawBody)).toBe('{"ok":true}');
  });

  it('reports a duplicate (same gateway and dedupe key) and keeps the first row', async () => {
    const first = await repos.webhookInbox.record(callback('evt-2'));
    const second = await runner.run((r) =>
      r.webhookInbox.record(callback('evt-2')),
    );

    expect(second.duplicate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
  });
});

describe('IdempotencyKeyRepository', () => {
  it('stores a key with its request hash and response, and finds it', async () => {
    const payment = await givenPayment();
    const expiresAt = new Date('2030-01-02T00:00:00.000Z');

    await runner.run((r) =>
      r.idempotencyKeys.create({
        key: 'idem-1',
        requestHash: 'sha256:abc',
        responseStatus: 201,
        responseBody: { id: payment.id },
        paymentId: payment.id,
        expiresAt,
      }),
    );

    expect(await repos.idempotencyKeys.find('idem-1')).toEqual({
      key: 'idem-1',
      requestHash: 'sha256:abc',
      responseStatus: 201,
      responseBody: { id: payment.id },
      paymentId: payment.id,
      createdAt: expect.any(Date),
      expiresAt,
    });
    expect(await repos.idempotencyKeys.find('unknown')).toBeNull();
  });
});

describe('GatewayRawResponseRepository', () => {
  it('stores raw payloads per attempt, oldest first', async () => {
    const payment = await givenPayment();
    const attempt = await givenAttempt(payment.id);

    await runner.run(async (r) => {
      await r.gatewayRawResponses.record({
        attemptId: attempt.id,
        operation: 'initiate',
        payload: { code: '00', url: 'https://pay.example' },
      });
      await r.gatewayRawResponses.record({
        attemptId: attempt.id,
        operation: 'query',
        payload: ['anything', 1],
      });
    });

    const stored = await repos.gatewayRawResponses.listForAttempt(attempt.id);
    expect(stored.map((s) => [s.operation, s.payload])).toEqual([
      ['initiate', { code: '00', url: 'https://pay.example' }],
      ['query', ['anything', 1]],
    ]);
  });
});
