import { newId } from '../../src/payment-core/domain/ids.js';
import { PrismaTransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { ALL_ORGANIZATIONS } from '../../src/payment-core/domain/organization-scope.js';
import {
  DEFAULT_ORGANIZATION_ID,
  defaultScope,
  ensureOtherOrganization,
  otherScope,
} from '../setup/organizations.js';

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
    r.payments.create(defaultScope, {
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
    r.payments.createAttempt(defaultScope, {
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
      await r.payments.update(defaultScope, payment.id, {
        status: 'CANCELLED',
      });
      await r.statusTransitions.record(defaultScope, {
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
      defaultScope,
      'PAYMENT',
      payment.id,
    );
    expect(trail).toEqual([
      {
        id: expect.any(String),
        organizationId: DEFAULT_ORGANIZATION_ID,
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
      r.statusTransitions.record(defaultScope, {
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: null,
        toStatus: 'PENDING',
        trigger: 'create_payment',
        actor: 'merchant',
      }),
    );
    const [entry] = await repos.statusTransitions.listForEntity(
      defaultScope,
      'PAYMENT',
      payment.id,
    );
    expect(entry).toMatchObject({ fromStatus: null, reason: null });
  });

  it('rolls back with the change it records', async () => {
    const payment = await givenPayment();

    await runAndRollBack(async (r) => {
      await r.payments.update(defaultScope, payment.id, {
        status: 'CANCELLED',
      });
      await r.statusTransitions.record(defaultScope, {
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        trigger: 'merchant_cancel',
        actor: 'merchant',
      });
    });

    expect(
      (await repos.payments.findById(defaultScope, payment.id))?.status,
    ).toBe('PENDING');
    expect(
      await repos.statusTransitions.listForEntity(
        defaultScope,
        'PAYMENT',
        payment.id,
      ),
    ).toEqual([]);
  });
});

describe('OutboxRepository', () => {
  it('writes an event with a UUID v7 id, unpublished, committed with the state change', async () => {
    const payment = await givenPayment();

    const event = await runner.run(async (r) => {
      await r.payments.update(defaultScope, payment.id, {
        status: 'CANCELLED',
      });
      return r.outbox.add(defaultScope, {
        eventType: 'PaymentCancelled',
        paymentId: payment.id,
        payload: { paymentId: payment.id, status: 'CANCELLED' },
      });
    });

    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await repos.outbox.listForPayment(defaultScope, payment.id)).toEqual(
      [
        {
          id: event.id,
          organizationId: DEFAULT_ORGANIZATION_ID,
          eventType: 'PaymentCancelled',
          paymentId: payment.id,
          payload: { paymentId: payment.id, status: 'CANCELLED' },
          createdAt: expect.any(Date),
          publishedAt: null,
        },
      ],
    );
  });

  it('leaves no outbox row when the state change rolls back', async () => {
    const payment = await givenPayment();

    await runAndRollBack(async (r) => {
      await r.payments.update(defaultScope, payment.id, {
        status: 'CANCELLED',
      });
      await r.outbox.add(defaultScope, {
        eventType: 'PaymentCancelled',
        paymentId: payment.id,
        payload: {},
      });
    });

    expect(await repos.outbox.listForPayment(defaultScope, payment.id)).toEqual(
      [],
    );
    expect(
      (await repos.payments.findById(defaultScope, payment.id))?.status,
    ).toBe('PENDING');
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
      defaultScope,
      callback('evt-1'),
    );

    expect(duplicate).toBe(false);
    const found = await repos.webhookInbox.findById(defaultScope, entry.id);
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
    const first = await repos.webhookInbox.record(
      defaultScope,
      callback('evt-2'),
    );
    const second = await runner.run((r) =>
      r.webhookInbox.record(defaultScope, callback('evt-2')),
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
      r.idempotencyKeys.create(defaultScope, {
        key: 'idem-1',
        requestHash: 'sha256:abc',
        responseStatus: 201,
        responseBody: { id: payment.id },
        paymentId: payment.id,
        expiresAt,
      }),
    );

    expect(await repos.idempotencyKeys.find(defaultScope, 'idem-1')).toEqual({
      organizationId: DEFAULT_ORGANIZATION_ID,
      key: 'idem-1',
      requestHash: 'sha256:abc',
      responseStatus: 201,
      responseBody: { id: payment.id },
      paymentId: payment.id,
      createdAt: expect.any(Date),
      expiresAt,
    });
    expect(
      await repos.idempotencyKeys.find(defaultScope, 'unknown'),
    ).toBeNull();
  });
});

describe('GatewayRawResponseRepository', () => {
  it('stores raw payloads per attempt, oldest first', async () => {
    const payment = await givenPayment();
    const attempt = await givenAttempt(payment.id);

    await runner.run(async (r) => {
      await r.gatewayRawResponses.record(defaultScope, {
        attemptId: attempt.id,
        operation: 'initiate',
        payload: { code: '00', url: 'https://pay.example' },
      });
      await r.gatewayRawResponses.record(defaultScope, {
        attemptId: attempt.id,
        operation: 'query',
        payload: ['anything', 1],
      });
    });

    const stored = await repos.gatewayRawResponses.listForAttempt(
      defaultScope,
      attempt.id,
    );
    expect(stored.map((s) => [s.operation, s.payload])).toEqual([
      ['initiate', { code: '00', url: 'https://pay.example' }],
      ['query', ['anything', 1]],
    ]);
  });
});

describe('Organization scope', () => {
  beforeEach(() => ensureOtherOrganization(prisma));

  it('finds a Payment only inside its own Organization, or across all of them when asked', async () => {
    const payment = await givenPayment();

    expect(
      await repos.payments.findById(defaultScope, payment.id),
    ).toMatchObject({
      id: payment.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(await repos.payments.findById(otherScope, payment.id)).toBeNull();
    expect(
      await repos.payments.findById(ALL_ORGANIZATIONS, payment.id),
    ).toMatchObject({ id: payment.id });
  });

  it('locks nothing and loads nothing for another Organization', async () => {
    const payment = await givenPayment();

    const found = await runner.run((r) =>
      r.payments.findForUpdate(otherScope, payment.id),
    );

    expect(found).toBeNull();
  });

  it('refuses to update a Payment of another Organization', async () => {
    const payment = await givenPayment();

    await expect(
      repos.payments.update(otherScope, payment.id, { status: 'CANCELLED' }),
    ).rejects.toThrow();

    expect(
      (await repos.payments.findById(defaultScope, payment.id))?.status,
    ).toBe('PENDING');
  });

  it('keeps the Upstream Reference per Organization', async () => {
    const payment = await givenPayment();
    const reference = payment.merchantOrderId;

    expect(
      await repos.payments.findIdByUpstreamReference(defaultScope, reference),
    ).toBe(payment.id);
    expect(
      await repos.payments.findIdByUpstreamReference(otherScope, reference),
    ).toBeNull();
  });

  it('stamps every row it writes with the scope Organization', async () => {
    const payment = await givenPayment();
    const attempt = await givenAttempt(payment.id);
    await runner.run(async (r) => {
      await r.statusTransitions.record(defaultScope, {
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: null,
        toStatus: 'PENDING',
        trigger: 'create_payment',
        actor: 'merchant',
      });
      await r.outbox.add(defaultScope, {
        eventType: 'PaymentCreated',
        paymentId: payment.id,
        payload: {},
      });
      await r.gatewayRawResponses.record(defaultScope, {
        attemptId: attempt.id,
        operation: 'initiate',
        payload: {},
      });
    });

    expect(attempt.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    const trail = await repos.statusTransitions.listForEntity(
      defaultScope,
      'PAYMENT',
      payment.id,
    );
    expect(trail[0]?.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(
      await repos.statusTransitions.listForEntity(
        otherScope,
        'PAYMENT',
        payment.id,
      ),
    ).toEqual([]);
    expect(await repos.outbox.listForPayment(otherScope, payment.id)).toEqual(
      [],
    );
    expect(
      await repos.gatewayRawResponses.listForAttempt(otherScope, attempt.id),
    ).toEqual([]);
  });

  it('keeps an Idempotency-Key and a callback inside their Organization', async () => {
    const payment = await givenPayment();
    await runner.run(async (r) => {
      await r.idempotencyKeys.create(defaultScope, {
        key: 'k',
        requestHash: 'h',
        responseStatus: 201,
        responseBody: {},
        paymentId: payment.id,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      });
    });
    const { entry } = await repos.webhookInbox.record(defaultScope, {
      gatewayId: 'fake',
      dedupeKey: 'd',
      rawBody: new Uint8Array([1]),
      headers: {},
      query: {},
    });

    expect(await repos.idempotencyKeys.find(defaultScope, 'k')).not.toBeNull();
    expect(await repos.idempotencyKeys.find(otherScope, 'k')).toBeNull();
    expect(await repos.webhookInbox.findById(otherScope, entry.id)).toBeNull();
    expect(
      await repos.webhookInbox.claim(otherScope, entry.id, new Date()),
    ).toBeNull();
    // The same callback body is a separate row in another Organization.
    const other = await repos.webhookInbox.record(otherScope, {
      gatewayId: 'fake',
      dedupeKey: 'd',
      rawBody: new Uint8Array([1]),
      headers: {},
      query: {},
    });
    expect(other.duplicate).toBe(false);
    expect(other.entry.id).not.toBe(entry.id);
  });
});
