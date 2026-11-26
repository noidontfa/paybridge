import { runSeed } from '../../../seed/seed.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import {
  CALLBACK_STATUSES,
  callbackDetailSchema,
  callbackListSchema,
} from '../../contract/console/callbacks.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';
import { DEFAULT_ORGANIZATION_ID } from '../../setup/organizations.js';

// Ticket 07: GET /internal/callbacks[/:id] over HTTP on real PostgreSQL.

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

interface CallbackInput {
  id?: string;
  gatewayId?: string;
  status?: (typeof CALLBACK_STATUSES)[number];
  providerEventId?: string | null;
  attemptKey?: string | null;
  rawBody?: string | Buffer;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  attempts?: number;
  lastError?: string;
  receivedAt?: Date;
  processedAt?: Date;
}

async function insertCallback(input: CallbackInput = {}): Promise<string> {
  const id = input.id ?? newId();
  await prisma.webhookInbox.create({
    data: {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      gatewayId: input.gatewayId ?? 'stripe',
      dedupeKey: `dedupe-${id}`,
      providerEventId: input.providerEventId ?? null,
      attemptKey: input.attemptKey ?? null,
      rawBody: Buffer.from(input.rawBody ?? '{}'),
      headers: input.headers ?? {},
      query: input.query ?? {},
      status: input.status ?? 'RECEIVED',
      attempts: input.attempts ?? 0,
      lastError: input.lastError ?? null,
      receivedAt: input.receivedAt ?? new Date(T0),
      processedAt: input.processedAt ?? null,
    },
  });
  return id;
}

/** A Payment with one attempt; returns both ids (the attempt id is the Attempt Key). */
async function insertPaymentWithAttempt(ref: string) {
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

const list = (query = '') =>
  api.getValid(`/internal/callbacks${query}`, callbackListSchema);
const ids = async (query = '') =>
  (await list(query)).items.map((c) => c.providerEventId);

describe('seeded data', () => {
  it('lists the six seeded Callbacks, every status, and the no-event-id and unknown-attempt cases', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    const page = await list('?limit=100');
    expect(page.items).toHaveLength(6);
    expect(new Set(page.items.map((c) => c.status))).toEqual(
      new Set(CALLBACK_STATUSES),
    );
    expect(page.items.some((c) => c.providerEventId === null)).toBe(true);

    const details = await Promise.all(
      page.items.map((c) =>
        api.getValid(`/internal/callbacks/${c.id}`, callbackDetailSchema),
      ),
    );
    // Linked to a Payment, and one naming an Attempt Key that matches nothing.
    expect(details.filter((d) => d.paymentId !== null)).toHaveLength(5);
    const orphan = details.filter((d) => d.paymentId === null);
    expect(orphan).toHaveLength(1);
    expect(orphan[0].attemptKey).not.toBeNull();
    expect(details.find((d) => d.status === 'FAILED')?.lastError).toBeTruthy();
  });
});

describe('list', () => {
  it('returns the list fields, newest first', async () => {
    await insertCallback({
      providerEventId: 'old',
      receivedAt: new Date(T0 - 10 * MIN),
    });
    const attemptKey = newId();
    await insertCallback({
      gatewayId: 'fake',
      providerEventId: 'new',
      attemptKey,
      status: 'PROCESSED',
      attempts: 2,
      processedAt: new Date(T0 + MIN),
    });
    const { items, nextCursor } = await list();
    expect(nextCursor).toBeNull();
    expect(items.map((c) => c.providerEventId)).toEqual(['new', 'old']);
    expect(items[0]).toMatchObject({
      gatewayId: 'fake',
      attemptKey,
      status: 'PROCESSED',
      attempts: 2,
      receivedAt: new Date(T0).toISOString(),
      processedAt: new Date(T0 + MIN).toISOString(),
    });
    expect(items[1].processedAt).toBeNull();
    expect(items[0]).not.toHaveProperty('rawBody');
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
  });

  describe('filters', () => {
    beforeEach(async () => {
      await insertCallback({
        providerEventId: 'a',
        gatewayId: 'stripe',
        status: 'FAILED',
        receivedAt: new Date(T0 - 3 * MIN),
      });
      await insertCallback({
        providerEventId: 'b',
        gatewayId: 'fake',
        status: 'FAILED',
        receivedAt: new Date(T0 - 2 * MIN),
      });
      await insertCallback({
        providerEventId: 'c',
        gatewayId: 'fake',
        status: 'PROCESSED',
        receivedAt: new Date(T0 - 1 * MIN),
      });
    });

    it('filters by gateway and by status, alone or together', async () => {
      expect(await ids('?gatewayId=fake')).toEqual(['c', 'b']);
      expect(await ids('?status=FAILED')).toEqual(['b', 'a']);
      expect(await ids('?gatewayId=fake&status=FAILED')).toEqual(['b']);
      expect(await ids('?gatewayId=&status=')).toEqual(['c', 'b', 'a']);
    });

    it('searches Callback id, Provider Event id, Attempt Key and the Payment it resolves to', async () => {
      const { paymentId, attemptId } =
        await insertPaymentWithAttempt('ORD-Search_1');
      const linked = await insertCallback({
        providerEventId: 'Evt-Linked',
        attemptKey: attemptId,
      });
      expect(await ids('?q=evt-link')).toEqual(['Evt-Linked']);
      expect(await ids(`?q=${linked.toUpperCase()}`)).toEqual(['Evt-Linked']);
      expect(await ids(`?q=${attemptId}`)).toEqual(['Evt-Linked']);
      expect(await ids(`?q=${paymentId}`)).toEqual(['Evt-Linked']);
      expect(await ids('?q=ord-search')).toEqual(['Evt-Linked']);
      expect(await ids('?q=nothing-like-this')).toEqual([]);
    });

    it('treats search wildcards as literal text', async () => {
      await insertCallback({ providerEventId: 'evt_100%' });
      expect(await ids('?q=%25')).toEqual(['evt_100%']);
    });
  });

  describe('paging', () => {
    it('pages through every row once, with ties on the received time', async () => {
      for (let i = 0; i < 11; i++) {
        await insertCallback({
          providerEventId: `e${i}`,
          receivedAt: new Date(T0 - (i % 3) * MIN),
        });
      }
      const all = await ids('?limit=100');
      const seen: (string | null)[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await list(
          `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...page.items.map((c) => c.providerEventId));
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 20);
      expect(pages).toBe(4);
      expect(seen).toEqual(all);
      expect(new Set(seen).size).toBe(11);
    });

    it('loses and repeats nothing when a Callback arrives between requests', async () => {
      for (let i = 0; i < 6; i++) {
        await insertCallback({
          providerEventId: `e${i}`,
          receivedAt: new Date(T0 - i * MIN),
        });
      }
      const first = await list('?limit=3');
      await insertCallback({
        providerEventId: 'late',
        receivedAt: new Date(T0 + MIN),
      });
      const rest = await list(`?limit=3&cursor=${first.nextCursor}`);
      expect(rest.nextCursor).toBeNull();
      expect(
        [...first.items, ...rest.items].map((c) => c.providerEventId),
      ).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5']);
    });
  });

  it.each([
    ['a malformed cursor', '?cursor=%25%25'],
    [
      'a cursor that is not ours',
      `?cursor=${Buffer.from('12').toString('base64url')}`,
    ],
    ['an unknown status', '?status=DONE'],
    ['limit 0', '?limit=0'],
    ['limit above 100', '?limit=101'],
  ])('rejects %s with 400', async (_name, query) => {
    await api.expectRejected(`/internal/callbacks${query}`);
  });
});

describe('detail', () => {
  it('adds headers, query, raw body as text, last error and the resolved Payment', async () => {
    const { paymentId, attemptId } = await insertPaymentWithAttempt('REF');
    const id = await insertCallback({
      attemptKey: attemptId,
      status: 'FAILED',
      attempts: 3,
      lastError: 'boom',
      rawBody: '{"msg":"héllo <b>"}',
      headers: { 'stripe-signature': 't=1,v1=abc' },
      query: { a: '1' },
    });
    const detail = await api.getValid(
      `/internal/callbacks/${id}`,
      callbackDetailSchema,
    );
    expect(detail).toMatchObject({
      id,
      attemptKey: attemptId,
      paymentId,
      status: 'FAILED',
      attempts: 3,
      lastError: 'boom',
      rawBody: '{"msg":"héllo <b>"}',
      headers: { 'stripe-signature': 't=1,v1=abc' },
      query: { a: '1' },
    });
  });

  it('has a null paymentId when the Attempt Key matches no PaymentTransaction, or none is named', async () => {
    const unknown = await insertCallback({ attemptKey: newId() });
    const none = await insertCallback({});
    for (const id of [unknown, none]) {
      const detail = await api.getValid(
        `/internal/callbacks/${id}`,
        callbackDetailSchema,
      );
      expect(detail.paymentId).toBeNull();
    }
  });

  it('answers 404 in the standard error envelope for an unknown or malformed id', async () => {
    for (const id of [newId(), 'not-a-uuid']) {
      const res = await api.get(`/internal/callbacks/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404 });
    }
  });
});
