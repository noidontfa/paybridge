import { runSeed } from '../../../seed/seed.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import { paymentEventListSchema } from '../../contract/console/payment-events.js';
import {
  PAYMENT_EVENT_TYPES,
  paymentEventSchema,
} from '../../contract/console/schemas.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';
import { DEFAULT_ORGANIZATION_ID } from '../../setup/organizations.js';

// Ticket 07: GET /internal/payment-events[/:id] over HTTP on real PostgreSQL.

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

async function insertPayment(ref: string): Promise<string> {
  const id = newId();
  await prisma.payment.create({
    data: {
      id,
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
  return id;
}

interface EventInput {
  paymentId: string;
  type?: (typeof PAYMENT_EVENT_TYPES)[number];
  payload?: Prisma.InputJsonObject;
  createdAt?: Date;
  publishedAt?: Date | null;
  id?: string;
}

async function insertEvent(input: EventInput): Promise<string> {
  const id = input.id ?? newId();
  await prisma.outboxEvent.create({
    data: {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      eventType: input.type ?? 'PaymentCreated',
      paymentId: input.paymentId,
      payload: input.payload ?? {},
      createdAt: input.createdAt ?? new Date(T0),
      publishedAt: input.publishedAt ?? null,
    },
  });
  return id;
}

const list = (query = '') =>
  api.getValid(`/internal/payment-events${query}`, paymentEventListSchema);

describe('seeded data', () => {
  it('lists the six seeded Payment Events: every type, published and unpublished, each with a payload in its detail', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    const page = await list('?limit=100');
    expect(page.items).toHaveLength(6);
    expect(new Set(page.items.map((e) => e.type))).toEqual(
      new Set(PAYMENT_EVENT_TYPES),
    );
    expect(page.items.some((e) => e.publishedAt === null)).toBe(true);
    expect(page.items.some((e) => e.publishedAt !== null)).toBe(true);
    for (const item of page.items) {
      const detail = await api.getValid(
        `/internal/payment-events/${item.id}`,
        paymentEventSchema,
      );
      expect(detail).toMatchObject(item);
      expect(Object.keys(detail.payload).length).toBeGreaterThan(0);
    }
  });
});

describe('list', () => {
  it('omits the payload and returns newest first', async () => {
    const paymentId = await insertPayment('A');
    await insertEvent({
      paymentId,
      createdAt: new Date(T0 - MIN),
      payload: { n: 1 },
    });
    const newer = await insertEvent({
      paymentId,
      type: 'PaymentSucceeded',
      payload: { n: 2 },
      publishedAt: new Date(T0 + MIN),
    });
    const { items, nextCursor } = await list();
    expect(nextCursor).toBeNull();
    expect(items.map((e) => e.type)).toEqual([
      'PaymentSucceeded',
      'PaymentCreated',
    ]);
    expect(items[0]).toEqual({
      id: newer,
      type: 'PaymentSucceeded',
      paymentId,
      createdAt: new Date(T0).toISOString(),
      publishedAt: new Date(T0 + MIN).toISOString(),
    });
    expect(items[1].publishedAt).toBeNull();
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
  });

  describe('filters', () => {
    let paymentId: string;
    beforeEach(async () => {
      paymentId = await insertPayment('INV-Alpha');
      const other = await insertPayment('ORD_100%');
      await insertEvent({
        paymentId,
        type: 'PaymentCreated',
        createdAt: new Date(T0 - 3 * MIN),
      });
      await insertEvent({
        paymentId,
        type: 'PaymentSucceeded',
        createdAt: new Date(T0 - 2 * MIN),
        publishedAt: new Date(T0),
      });
      await insertEvent({
        paymentId: other,
        type: 'PaymentCreated',
        createdAt: new Date(T0 - 1 * MIN),
      });
    });
    const types = async (query: string) =>
      (await list(query)).items.map((e) => e.type);

    it('filters by type', async () => {
      expect(await types('?type=PaymentCreated')).toEqual([
        'PaymentCreated',
        'PaymentCreated',
      ]);
      expect(await types('?type=PaymentExpired')).toEqual([]);
    });

    it('filters by published or unpublished', async () => {
      expect(await types('?published=true')).toEqual(['PaymentSucceeded']);
      expect(await types('?published=false')).toEqual([
        'PaymentCreated',
        'PaymentCreated',
      ]);
      expect(await types('?published=')).toHaveLength(3);
    });

    it('combines type and published', async () => {
      expect(await types('?type=PaymentCreated&published=true')).toEqual([]);
      expect(await types('?type=PaymentSucceeded&published=true')).toEqual([
        'PaymentSucceeded',
      ]);
    });

    it('searches event id, Payment id and Upstream Reference', async () => {
      const first = (await list('?limit=1')).items[0];
      expect(await list(`?q=${first.id.toUpperCase()}`)).toMatchObject({
        items: [{ id: first.id }],
      });
      expect((await list(`?q=${paymentId}`)).items).toHaveLength(2);
      expect((await list('?q=inv-alp')).items).toHaveLength(2);
      expect((await list('?q=%25')).items).toHaveLength(1);
      expect((await list('?q=nothing-like-this')).items).toHaveLength(0);
    });
  });

  describe('paging', () => {
    it('pages through every row once, with ties on the created time', async () => {
      const paymentId = await insertPayment('A');
      for (let i = 0; i < 11; i++) {
        await insertEvent({
          paymentId,
          createdAt: new Date(T0 - (i % 3) * MIN),
        });
      }
      const all = (await list('?limit=100')).items.map((e) => e.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await list(
          `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...page.items.map((e) => e.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 20);
      expect(pages).toBe(4);
      expect(seen).toEqual(all);
      expect(new Set(seen).size).toBe(11);
    });
  });

  it.each([
    ['a malformed cursor', '?cursor=%25%25'],
    [
      'a cursor that is not ours',
      `?cursor=${Buffer.from('12').toString('base64url')}`,
    ],
    ['an unknown type', '?type=PaymentRefunded'],
    ['an unknown published value', '?published=maybe'],
    ['limit 0', '?limit=0'],
    ['limit above 100', '?limit=101'],
  ])('rejects %s with 400', async (_name, query) => {
    await api.expectRejected(`/internal/payment-events${query}`);
  });
});

describe('detail', () => {
  it('includes the payload', async () => {
    const paymentId = await insertPayment('A');
    const id = await insertEvent({
      paymentId,
      type: 'PaymentRequiresReview',
      payload: { paymentId, reason: 'AMOUNT_MISMATCH', nested: { a: [1, 2] } },
    });
    const detail = await api.getValid(
      `/internal/payment-events/${id}`,
      paymentEventSchema,
    );
    expect(detail).toMatchObject({
      id,
      type: 'PaymentRequiresReview',
      paymentId,
      payload: { reason: 'AMOUNT_MISMATCH', nested: { a: [1, 2] } },
      publishedAt: null,
    });
  });

  it('answers 404 in the standard error envelope for an unknown or malformed id', async () => {
    for (const id of [newId(), 'not-a-uuid']) {
      const res = await api.get(`/internal/payment-events/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404 });
    }
  });
});
