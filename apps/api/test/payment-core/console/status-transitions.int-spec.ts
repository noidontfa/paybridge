import { runSeed } from '../../../seed/seed.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import { auditListSchema } from '../../contract/console/status-transitions.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';
import { DEFAULT_ORGANIZATION_ID } from '../../setup/organizations.js';

// Ticket 07: GET /internal/status-transitions (the audit log) over HTTP on
// real PostgreSQL.

const prisma = createTestPrismaClient();
let api: ConsoleApp;

beforeAll(async () => {
  api = await createConsoleApp();
});
afterAll(async () => {
  await api.app.close();
  await prisma.$disconnect();
});
beforeEach(() => resetDatabase(prisma));

const T0 = Date.parse('2026-06-10T12:00:00.000Z');
const MIN = 60_000;

async function insertPayment(ref: string) {
  const paymentId = newId();
  const attemptId = newId();
  await prisma.payment.create({
    data: {
      id: paymentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      merchantOrderId: ref,
      amount: new Prisma.Decimal('1000'),
      currency: 'VND',
      status: 'PENDING',
      expiresAt: new Date(T0 + 3_600_000),
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      id: attemptId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      paymentId,
      gatewayId: 'stripe',
      status: 'PENDING',
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    },
  });
  return { paymentId, attemptId };
}

interface TransitionInput {
  entityType?: 'PAYMENT' | 'PAYMENT_TRANSACTION' | 'REFUND';
  entityId: string;
  from?: string | null;
  to?: string;
  trigger?: string;
  actor?: string;
  reason?: string | null;
  createdAt?: Date;
  id?: string;
}

async function insertTransition(input: TransitionInput): Promise<string> {
  const id = input.id ?? newId();
  await prisma.statusTransition.create({
    data: {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      entityType: input.entityType ?? 'PAYMENT',
      entityId: input.entityId,
      fromStatus: input.from ?? null,
      toStatus: input.to ?? 'PENDING',
      trigger: input.trigger ?? 'create_payment',
      actor: input.actor ?? 'system',
      reason: input.reason ?? null,
      createdAt: input.createdAt ?? new Date(T0),
    },
  });
  return id;
}

const list = (query = '') =>
  api.getValid(`/internal/status-transitions${query}`, auditListSchema);

describe('seeded data', () => {
  it('lists every trigger, and links each Payment and PaymentTransaction row to its Payment', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    // The API is scoped to the default Organization: the second Organization's
    // audit rows must not appear.
    const count = await prisma.statusTransition.count({
      where: { organizationId: DEFAULT_ORGANIZATION_ID },
    });
    const page = await list('?limit=100');
    // Paged in full by following the cursor.
    const all = [...page.items];
    let cursor = page.nextCursor;
    while (cursor) {
      const next = await list(
        `?limit=100&cursor=${encodeURIComponent(cursor)}`,
      );
      all.push(...next.items);
      cursor = next.nextCursor;
    }
    expect(all).toHaveLength(count);
    expect(new Set(all.map((t) => t.trigger))).toEqual(
      new Set([
        'create_payment',
        'expiry',
        'gateway_accepted',
        'gateway_rejected',
        'gateway_switch',
        'merchant_cancel',
        'operator_note',
        'operator_resolution',
        'start_attempt',
        'status_query',
        'webhook',
      ]),
    );
    expect(all.every((t) => t.paymentId !== null)).toBe(true);
    const attempts = await prisma.paymentTransaction.findMany();
    for (const row of all.filter(
      (t) => t.entityType === 'PAYMENT_TRANSACTION',
    )) {
      expect(row.paymentId).toBe(
        attempts.find((a) => a.id === row.entityId)?.paymentId,
      );
    }
  });
});

describe('list', () => {
  it('carries every audit field, newest first', async () => {
    const { paymentId, attemptId } = await insertPayment('A');
    await insertTransition({
      entityId: paymentId,
      createdAt: new Date(T0 - MIN),
    });
    const id = await insertTransition({
      entityType: 'PAYMENT_TRANSACTION',
      entityId: attemptId,
      from: 'REQUIRES_REVIEW',
      to: 'SUCCEEDED',
      trigger: 'operator_resolution',
      actor: 'operator:alice',
      reason: 'checked the dashboard',
    });
    const { items, nextCursor } = await list();
    expect(nextCursor).toBeNull();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id,
      entityType: 'PAYMENT_TRANSACTION',
      entityId: attemptId,
      fromStatus: 'REQUIRES_REVIEW',
      toStatus: 'SUCCEEDED',
      trigger: 'operator_resolution',
      actor: 'operator:alice',
      reason: 'checked the dashboard',
      createdAt: new Date(T0).toISOString(),
      paymentId,
    });
    expect(items[1]).toMatchObject({
      fromStatus: null,
      reason: null,
      paymentId,
    });
  });

  it('resolves a Payment to itself, a PaymentTransaction to its Payment and a Refund to none', async () => {
    const { paymentId, attemptId } = await insertPayment('A');
    const refundId = newId();
    await insertTransition({ entityType: 'PAYMENT', entityId: paymentId });
    await insertTransition({
      entityType: 'PAYMENT_TRANSACTION',
      entityId: attemptId,
    });
    await insertTransition({ entityType: 'REFUND', entityId: refundId });
    const byType = new Map(
      (await list()).items.map((t) => [t.entityType, t.paymentId]),
    );
    expect(byType.get('PAYMENT')).toBe(paymentId);
    expect(byType.get('PAYMENT_TRANSACTION')).toBe(paymentId);
    expect(byType.get('REFUND')).toBeNull();
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
  });

  describe('filters', () => {
    let paymentId: string;
    let attemptId: string;
    beforeEach(async () => {
      ({ paymentId, attemptId } = await insertPayment('INV-Alpha'));
      const other = await insertPayment('ORD_100%');
      await insertTransition({
        entityId: paymentId,
        trigger: 'create_payment',
        createdAt: new Date(T0 - 4 * MIN),
      });
      await insertTransition({
        entityType: 'PAYMENT_TRANSACTION',
        entityId: attemptId,
        trigger: 'start_attempt',
        createdAt: new Date(T0 - 3 * MIN),
      });
      await insertTransition({
        entityType: 'PAYMENT_TRANSACTION',
        entityId: attemptId,
        trigger: 'operator_resolution',
        actor: 'operator:alice',
        createdAt: new Date(T0 - 2 * MIN),
      });
      await insertTransition({
        entityId: other.paymentId,
        trigger: 'create_payment',
        actor: 'operator:bob',
        createdAt: new Date(T0 - 1 * MIN),
      });
    });
    const triggers = async (query: string) =>
      (await list(query)).items.map((t) => t.trigger);

    it('filters by entity type', async () => {
      expect(await triggers('?entityType=PAYMENT_TRANSACTION')).toEqual([
        'operator_resolution',
        'start_attempt',
      ]);
      expect(await triggers('?entityType=REFUND')).toEqual([]);
    });

    it('filters by entity id', async () => {
      expect(await triggers(`?entityId=${attemptId}`)).toEqual([
        'operator_resolution',
        'start_attempt',
      ]);
      expect(await triggers(`?entityId=${newId()}`)).toEqual([]);
    });

    it('filters by trigger and by actor', async () => {
      expect(await triggers('?trigger=create_payment')).toEqual([
        'create_payment',
        'create_payment',
      ]);
      expect(await triggers('?actor=operator:alice')).toEqual([
        'operator_resolution',
      ]);
      expect(
        await triggers('?trigger=create_payment&actor=operator:bob'),
      ).toEqual(['create_payment']);
      expect(
        await triggers('?trigger=&actor=&entityType=&entityId=&q='),
      ).toHaveLength(4);
    });

    it('searches Payment id, Upstream Reference and entity id, ignoring case', async () => {
      expect(await triggers(`?q=${paymentId.toUpperCase()}`)).toHaveLength(3);
      expect(await triggers(`?q=${paymentId}`)).toHaveLength(3);
      expect(await triggers(`?q=${attemptId}`)).toEqual([
        'operator_resolution',
        'start_attempt',
      ]);
      expect(await triggers('?q=inv-alp')).toHaveLength(3);
      expect(await triggers('?q=%25')).toEqual(['create_payment']);
      expect(await triggers('?q=nothing-like-this')).toEqual([]);
    });
  });

  describe('paging', () => {
    it('pages through every row once, with ties on the time', async () => {
      const { paymentId } = await insertPayment('A');
      for (let i = 0; i < 11; i++) {
        await insertTransition({
          entityId: paymentId,
          createdAt: new Date(T0 - (i % 3) * MIN),
        });
      }
      const all = (await list('?limit=100')).items.map((t) => t.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await list(
          `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...page.items.map((t) => t.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 20);
      expect(pages).toBe(4);
      expect(seen).toEqual(all);
      expect(new Set(seen).size).toBe(11);
    });

    it('loses and repeats nothing when a transition is added between requests', async () => {
      const { paymentId } = await insertPayment('A');
      for (let i = 0; i < 6; i++) {
        await insertTransition({
          entityId: paymentId,
          createdAt: new Date(T0 - i * MIN),
        });
      }
      const first = await list('?limit=3');
      await insertTransition({
        entityId: paymentId,
        createdAt: new Date(T0 + MIN),
      });
      const rest = await list(`?limit=3&cursor=${first.nextCursor}`);
      expect(rest.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...rest.items].map((t) => t.id)).size,
      ).toBe(6);
    });
  });

  it.each([
    ['a malformed cursor', '?cursor=%25%25'],
    [
      'a cursor that is not ours',
      `?cursor=${Buffer.from('12').toString('base64url')}`,
    ],
    ['an unknown entity type', '?entityType=ORDER'],
    ['an entity id that is not a UUID', '?entityId=abc'],
    ['limit 0', '?limit=0'],
    ['limit above 100', '?limit=101'],
  ])('rejects %s with 400', async (_name, query) => {
    await api.expectRejected(`/internal/status-transitions${query}`);
  });
});
