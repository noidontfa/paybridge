import { runSeed } from '../../../seed/seed.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import { paymentListSchema } from '../../contract/console/payments-list.js';
import {
  ATTEMPT_STATUSES,
  PAYMENT_STATUSES,
} from '../../contract/console/schemas.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';

// Ticket 02: GET /internal/payments over HTTP on real PostgreSQL. Every
// success response is parsed with the Console's copied schema (getValid).

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

const HOUR = 3_600_000;
const T0 = Date.parse('2026-06-10T12:00:00.000Z');

interface AttemptInput {
  gatewayId: string;
  status?: (typeof ATTEMPT_STATUSES)[number];
  createdAt?: Date;
  id?: string;
}
interface PaymentInput {
  id?: string;
  ref: string;
  amount?: string;
  status?: (typeof PAYMENT_STATUSES)[number];
  createdAt?: Date;
  attempts?: AttemptInput[];
}

async function insertPayment(input: PaymentInput): Promise<string> {
  const id = input.id ?? newId();
  const createdAt = input.createdAt ?? new Date(T0);
  await prisma.payment.create({
    data: {
      id,
      merchantOrderId: input.ref,
      amount: new Prisma.Decimal(input.amount ?? '1000'),
      currency: 'VND',
      status: input.status ?? 'PENDING',
      expiresAt: new Date(createdAt.getTime() + HOUR),
      createdAt,
      updatedAt: createdAt,
    },
  });
  for (const [i, attempt] of (input.attempts ?? []).entries()) {
    await prisma.paymentTransaction.create({
      data: {
        id: attempt.id ?? newId(),
        paymentId: id,
        gatewayId: attempt.gatewayId,
        // Only the last attempt may be open (one open attempt per Payment).
        status: attempt.status ?? 'FAILED',
        createdAt: attempt.createdAt ?? new Date(createdAt.getTime() + i),
        updatedAt: createdAt,
      },
    });
  }
  return id;
}

const list = (query = '') =>
  api.getValid(`/internal/payments${query}`, paymentListSchema);
const refs = async (query = '') =>
  (await list(query)).items.map((p) => p.upstreamReference);

/** Follows `nextCursor` to the end and returns every row, in order. */
async function allPages(query: string) {
  const rows: { id: string; upstreamReference: string }[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await list(
      `?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    rows.push(...page.items);
    if (page.nextCursor === null) return rows;
    cursor = page.nextCursor;
  }
  throw new Error('paging did not end');
}

describe('seeded data', () => {
  it('lists every seeded Payment and every Payment status', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    const page = await list('?limit=100');
    expect(page.items).toHaveLength(22);
    expect(page.nextCursor).toBeNull();
    expect(new Set(page.items.map((p) => p.status))).toEqual(
      new Set(PAYMENT_STATUSES),
    );
    expect(page.items.some((p) => p.latestTransaction === null)).toBe(true);
    expect(
      new Set(
        page.items.flatMap((p) =>
          p.latestTransaction ? [p.latestTransaction.gatewayId] : [],
        ),
      ),
    ).toEqual(new Set(['stripe', 'fake']));
  });
});

describe('items', () => {
  it('carries decimal-string amounts in the major unit', async () => {
    await insertPayment({ ref: 'A', amount: '150000' });
    await insertPayment({ ref: 'B', amount: '1234.5' });
    const { items } = await list('?sort=amount&order=asc');
    expect(items.map((p) => p.amount)).toEqual(['1234.5', '150000']);
  });

  it('shows the gateway and status of the latest attempt, ties broken by id', async () => {
    const at = new Date(T0);
    const low = '00000000-0000-7000-8000-000000000001';
    const high = '00000000-0000-7000-8000-000000000002';
    await insertPayment({
      ref: 'SWITCHED',
      attempts: [
        {
          gatewayId: 'stripe',
          status: 'CANCELLED',
          createdAt: new Date(T0 - HOUR),
        },
        { gatewayId: 'fake', status: 'SUCCEEDED', createdAt: at },
      ],
    });
    await insertPayment({
      ref: 'TIED',
      attempts: [
        { gatewayId: 'stripe', status: 'FAILED', createdAt: at, id: low },
        { gatewayId: 'fake', status: 'FAILED', createdAt: at, id: high },
      ],
    });
    await insertPayment({ ref: 'NONE' });
    const byRef = new Map(
      (await list()).items.map((p) => [
        p.upstreamReference,
        p.latestTransaction,
      ]),
    );
    expect(byRef.get('SWITCHED')).toEqual({
      gatewayId: 'fake',
      status: 'SUCCEEDED',
    });
    expect(byRef.get('TIED')).toEqual({ gatewayId: 'fake', status: 'FAILED' });
    expect(byRef.get('NONE')).toBeNull();
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
    await insertPayment({ ref: 'A' });
    expect(await list('?status=EXPIRED')).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe('filters', () => {
  beforeEach(async () => {
    await insertPayment({
      ref: 'INV-Alpha',
      status: 'PENDING',
      createdAt: new Date(T0 - 3 * 24 * HOUR),
    });
    await insertPayment({
      ref: 'INV-beta',
      status: 'SUCCEEDED',
      createdAt: new Date(T0 - 2 * 24 * HOUR),
      attempts: [
        { gatewayId: 'stripe', status: 'CANCELLED' },
        { gatewayId: 'fake', status: 'SUCCEEDED' },
      ],
    });
    await insertPayment({
      ref: 'ORD_100%',
      status: 'SUCCEEDED',
      createdAt: new Date(T0 - 1 * 24 * HOUR),
      attempts: [{ gatewayId: 'stripe', status: 'SUCCEEDED' }],
    });
  });

  it('filters by status', async () => {
    expect(await refs('?status=SUCCEEDED')).toEqual(['ORD_100%', 'INV-beta']);
  });

  it('filters by the gateway of any attempt', async () => {
    expect((await refs('?gatewayId=stripe')).sort()).toEqual([
      'INV-beta',
      'ORD_100%',
    ]);
    expect(await refs('?gatewayId=fake')).toEqual(['INV-beta']);
  });

  it('searches the Upstream Reference by substring, ignoring case', async () => {
    expect(await refs('?q=inv-')).toEqual(['INV-beta', 'INV-Alpha']);
  });

  it('treats search wildcards as literal text', async () => {
    expect(await refs('?q=%25')).toEqual(['ORD_100%']);
    expect(await refs('?q=_')).toEqual(['ORD_100%']);
  });

  it('searches by Payment id', async () => {
    const id = await insertPayment({ ref: 'FINDME' });
    expect(await refs(`?q=${id}`)).toEqual(['FINDME']);
    expect(await refs(`?q=${id.toUpperCase()}`)).toEqual(['FINDME']);
  });

  it('filters by creation day, both bounds inclusive of the whole day', async () => {
    const day = (offset: number) =>
      new Date(T0 - offset * 24 * HOUR).toISOString().slice(0, 10);
    expect(await refs(`?createdFrom=${day(2)}`)).toEqual([
      'ORD_100%',
      'INV-beta',
    ]);
    expect(await refs(`?createdTo=${day(2)}`)).toEqual([
      'INV-beta',
      'INV-Alpha',
    ]);
    expect(await refs(`?createdFrom=${day(2)}&createdTo=${day(2)}`)).toEqual([
      'INV-beta',
    ]);
  });

  it('combines filters, and treats empty values as absent', async () => {
    expect(await refs('?status=SUCCEEDED&gatewayId=fake')).toEqual([
      'INV-beta',
    ]);
    expect(await refs('?status=&gatewayId=&q=&sort=&order=')).toHaveLength(3);
  });
});

describe('sorting', () => {
  beforeEach(async () => {
    await insertPayment({
      ref: 'A',
      amount: '900',
      createdAt: new Date(T0 - 2 * HOUR),
    });
    await insertPayment({
      ref: 'B',
      amount: '10000',
      createdAt: new Date(T0 - 1 * HOUR),
    });
    await insertPayment({ ref: 'C', amount: '50', createdAt: new Date(T0) });
  });

  it('defaults to newest first', async () => {
    expect(await refs()).toEqual(['C', 'B', 'A']);
  });

  it('sorts by creation time in both directions', async () => {
    expect(await refs('?sort=createdAt&order=asc')).toEqual(['A', 'B', 'C']);
    expect(await refs('?sort=createdAt&order=desc')).toEqual(['C', 'B', 'A']);
  });

  it('sorts by amount numerically in both directions', async () => {
    expect(await refs('?sort=amount&order=asc')).toEqual(['C', 'A', 'B']);
    expect(await refs('?sort=amount&order=desc')).toEqual(['B', 'A', 'C']);
  });
});

describe('paging', () => {
  async function insertMany(count: number) {
    // Few distinct values, so most pages cut through a tie.
    for (let i = 0; i < count; i++) {
      await insertPayment({
        ref: `P-${String(i).padStart(2, '0')}`,
        amount: String(100 * ((i % 3) + 1)),
        createdAt: new Date(T0 - (i % 4) * HOUR),
      });
    }
  }

  it.each([
    ['createdAt', 'desc'],
    ['createdAt', 'asc'],
    ['amount', 'desc'],
    ['amount', 'asc'],
  ])('pages through every row once, sorted by %s %s', async (sort, order) => {
    await insertMany(11);
    const all = await refs(
      `limit=100&sort=${sort}&order=${order}`.replace(/^/, '?'),
    );
    const paged = await allPages(`limit=3&sort=${sort}&order=${order}`);
    expect(paged.map((p) => p.upstreamReference)).toEqual(all);
    expect(new Set(paged.map((p) => p.id)).size).toBe(11);
  });

  it('returns nextCursor null exactly on the last page', async () => {
    await insertMany(4);
    expect((await list('?limit=4')).nextCursor).toBeNull();
    const first = await list('?limit=3');
    expect(first.nextCursor).not.toBeNull();
    expect(
      (await list(`?limit=3&cursor=${first.nextCursor}`)).nextCursor,
    ).toBeNull();
  });

  it('loses and repeats nothing when a Payment is inserted between requests', async () => {
    await insertMany(8);
    const first = await list('?limit=3');
    // Newest of all: lands before the cursor in the default order.
    await insertPayment({ ref: 'NEWCOMER', createdAt: new Date(T0 + HOUR) });
    const rest: string[] = [];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await list(`?limit=3&cursor=${cursor}`);
      rest.push(...page.items.map((p) => p.upstreamReference));
      cursor = page.nextCursor;
    }
    const seen = [...first.items.map((p) => p.upstreamReference), ...rest];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(8);
    expect(seen).not.toContain('NEWCOMER');
  });

  it('defaults to 20 rows and allows up to 100', async () => {
    await insertMany(21);
    expect((await list()).items).toHaveLength(20);
    expect((await list('?limit=100')).items).toHaveLength(21);
  });
});

describe('rejected requests', () => {
  it.each([
    ['a malformed cursor', '?cursor=%25%25'],
    [
      'a cursor that is not ours',
      `?cursor=${Buffer.from('12').toString('base64url')}`,
    ],
    ['an unknown status', '?status=MAYBE'],
    ['a repeated status', '?status=PENDING&status=EXPIRED'],
    ['limit 0', '?limit=0'],
    ['limit above 100', '?limit=101'],
    ['a non-integer limit', '?limit=1.5'],
    ['a non-numeric limit', '?limit=many'],
    ['an unknown sort', '?sort=status'],
    ['an unknown order', '?order=sideways'],
    ['a malformed date', '?createdFrom=yesterday'],
    ['an impossible date', '?createdTo=2026-02-30'],
  ])('rejects %s with 400', async (_name, query) => {
    await api.expectRejected(`/internal/payments${query}`);
  });

  it('rejects a cursor used under another sort', async () => {
    await insertPayment({ ref: 'A' });
    await insertPayment({ ref: 'B' });
    const { nextCursor } = await list('?limit=1&sort=createdAt');
    await api.expectRejected(
      `/internal/payments?sort=amount&cursor=${nextCursor}`,
    );
    await api.expectRejected(
      `/internal/payments?order=asc&cursor=${nextCursor}`,
    );
  });
});
