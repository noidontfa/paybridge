import request from 'supertest';
import { runSeed } from '../../../seed/seed.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import {
  REVIEW_REASONS,
  type ReviewReason,
} from '../../contract/console/schemas.js';
import {
  reviewListSchema,
  reviewSummarySchema,
} from '../../contract/console/reviews.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';

// Ticket 04: GET /internal/reviews and /internal/reviews/summary over HTTP on
// real PostgreSQL. Every success is parsed with the Console's copied schemas.

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
const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * HOUR);

interface ReviewInput {
  ref: string;
  reason?: ReviewReason;
  /** Hours since the Review opened. */
  openedAgoH?: number;
  open?: boolean;
  gatewayId?: string;
  refundRequired?: boolean;
  providerMetadata?: Prisma.InputJsonValue;
}

/** A Payment with one PaymentTransaction in (or out of) Review. */
async function insertReview(input: ReviewInput) {
  const paymentId = newId();
  const attemptId = newId();
  const open = input.open ?? true;
  await prisma.payment.create({
    data: {
      id: paymentId,
      merchantOrderId: input.ref,
      amount: new Prisma.Decimal('1500000'),
      currency: 'VND',
      status: open ? 'PENDING' : 'SUCCEEDED',
      expiresAt: ago(-1),
      createdAt: ago(500),
      updatedAt: ago(1),
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      id: attemptId,
      paymentId,
      gatewayId: input.gatewayId ?? 'stripe',
      status: open ? 'REQUIRES_REVIEW' : 'SUCCEEDED',
      providerRef: `pi_${input.ref}`,
      providerMetadata: input.providerMetadata,
      reviewReason: input.reason ?? 'AMBIGUOUS_PROVIDER_STATUS',
      reviewOpenedAt: ago(input.openedAgoH ?? 10),
      refundRequired: input.refundRequired ?? false,
      createdAt: ago(501),
      updatedAt: ago(1),
    },
  });
  return { paymentId, attemptId };
}

const list = (query = '') =>
  api.getValid(`/internal/reviews${query}`, reviewListSchema);
const refs = async (query = '') =>
  (await list(query)).items.map((r) => r.payment.upstreamReference);
const summary = () =>
  api.getValid('/internal/reviews/summary', reviewSummarySchema);

describe('items', () => {
  it('carries the Payment summary, flags and the 72 hour resolvable time', async () => {
    const { paymentId, attemptId } = await insertReview({
      ref: 'R1',
      reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT',
      openedAgoH: 100,
      refundRequired: true,
      gatewayId: 'fake',
    });
    const { items } = await list();
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({
      id: attemptId,
      reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT',
      state: 'open',
      gatewayId: 'fake',
      transactionStatus: 'REQUIRES_REVIEW',
      refundRequired: true,
      providerReportedAmount: null,
      payment: {
        id: paymentId,
        upstreamReference: 'R1',
        amount: '1500000',
        currency: 'VND',
        status: 'PENDING',
      },
    });
    const opened = Date.parse(item.reviewOpenedAt);
    expect(opened).toBe(ago(100).getTime());
    expect(Date.parse(item.resolvableAt)).toBe(opened + 72 * HOUR);
  });

  it('shows a Review younger and one older than 72 hours', async () => {
    await insertReview({ ref: 'OLD', openedAgoH: 100 });
    await insertReview({ ref: 'YOUNG', openedAgoH: 10 });
    const { items } = await list();
    const byRef = Object.fromEntries(
      items.map((r) => [r.payment.upstreamReference, r]),
    );
    expect(Date.parse(byRef.OLD.resolvableAt)).toBeLessThan(NOW);
    expect(Date.parse(byRef.YOUNG.resolvableAt)).toBeGreaterThan(NOW);
  });

  it('returns the provider-reported amount only where one exists', async () => {
    await insertReview({
      ref: 'MISMATCH',
      reason: 'AMOUNT_MISMATCH',
      providerMetadata: { providerReportedAmount: '1250000' },
    });
    await insertReview({ ref: 'PLAIN', providerMetadata: { other: 1 } });
    const { items } = await list();
    const amounts = Object.fromEntries(
      items.map((r) => [r.payment.upstreamReference, r.providerReportedAmount]),
    );
    expect(amounts).toEqual({ MISMATCH: '1250000', PLAIN: null });
  });

  it('accepts every review reason', async () => {
    for (const reason of REVIEW_REASONS) {
      await insertReview({ ref: reason, reason });
    }
    expect((await refs()).sort()).toEqual([...REVIEW_REASONS].sort());
  });
});

describe('state', () => {
  beforeEach(async () => {
    await insertReview({ ref: 'OPEN', openedAgoH: 20 });
    await insertReview({ ref: 'CLOSED', open: false, openedAgoH: 30 });
    // A PaymentTransaction that never had a Review is not a Review.
    const paymentId = newId();
    await prisma.payment.create({
      data: {
        id: paymentId,
        merchantOrderId: 'NEVER',
        amount: new Prisma.Decimal('1'),
        currency: 'VND',
        status: 'PENDING',
        expiresAt: ago(-1),
      },
    });
    await prisma.paymentTransaction.create({
      data: {
        id: newId(),
        paymentId,
        gatewayId: 'stripe',
        status: 'PENDING',
      },
    });
  });

  it('defaults to open', async () => {
    expect(await refs()).toEqual(['OPEN']);
    expect((await list()).items[0].state).toBe('open');
  });

  it('lists closed Reviews: a review reason and since resolved', async () => {
    const { items } = await list('?state=closed');
    expect(items.map((r) => r.payment.upstreamReference)).toEqual(['CLOSED']);
    expect(items[0]).toMatchObject({
      state: 'closed',
      transactionStatus: 'SUCCEEDED',
    });
  });

  it('counts open, total and open Reviews by reason', async () => {
    await insertReview({ ref: 'M', reason: 'AMOUNT_MISMATCH' });
    expect(await summary()).toEqual({
      open: 2,
      total: 3,
      byReason: {
        AMBIGUOUS_PROVIDER_STATUS: 1,
        AMOUNT_MISMATCH: 1,
        LATE_SUCCESS_ON_CLOSED_PAYMENT: 0,
        DUPLICATE_SUCCESS: 0,
      },
    });
  });
});

describe('filters', () => {
  beforeEach(async () => {
    await insertReview({
      ref: 'A',
      reason: 'AMOUNT_MISMATCH',
      gatewayId: 'stripe',
      openedAgoH: 30,
    });
    await insertReview({
      ref: 'B',
      reason: 'DUPLICATE_SUCCESS',
      gatewayId: 'fake',
      openedAgoH: 20,
    });
    await insertReview({ ref: 'C_100%', gatewayId: 'fake', openedAgoH: 10 });
  });

  it('filters by reason', async () => {
    expect(await refs('?reason=DUPLICATE_SUCCESS')).toEqual(['B']);
  });
  it('filters by gateway', async () => {
    expect(await refs('?gatewayId=fake')).toEqual(['B', 'C_100%']);
  });
  it('treats empty params as absent', async () => {
    expect(await refs('?reason=&gatewayId=&q=&state=')).toEqual([
      'A',
      'B',
      'C_100%',
    ]);
  });
  it('searches the Upstream Reference without LIKE wildcards', async () => {
    expect(await refs('?q=c_1')).toEqual(['C_100%']);
    expect(await refs('?q=%25')).toEqual(['C_100%']);
    expect(await refs('?q=_')).toEqual(['C_100%']);
  });
  it('searches by Payment id and Attempt Key', async () => {
    const { paymentId, attemptId } = await insertReview({ ref: 'D' });
    expect(await refs(`?q=${paymentId.toUpperCase()}`)).toEqual(['D']);
    expect(await refs(`?q=${attemptId}`)).toEqual(['D']);
  });
  it('combines filters', async () => {
    expect(await refs('?gatewayId=fake&reason=DUPLICATE_SUCCESS')).toEqual([
      'B',
    ]);
    expect(
      await refs('?gatewayId=stripe&reason=DUPLICATE_SUCCESS'),
    ).toEqual([]);
  });
});

describe('sort and paging', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) {
      await insertReview({ ref: `R${i}`, openedAgoH: i * 10 });
    }
    // Same opening time: the id breaks the tie.
    await insertReview({ ref: 'T1', openedAgoH: 25 });
    await insertReview({ ref: 'T2', openedAgoH: 25 });
  });

  async function allPages(query: string) {
    const rows: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page: Awaited<ReturnType<typeof list>> = await list(
        `?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      rows.push(...page.items.map((r) => r.id));
      if (page.nextCursor === null) return rows;
      cursor = page.nextCursor;
    }
    throw new Error('paging did not end');
  }

  it('is oldest first by default and newest first with order=desc', async () => {
    const asc = await refs();
    expect(asc.slice(0, 2)).toEqual(['R5', 'R4']);
    expect(asc.at(-1)).toBe('R1');
    expect(await refs('?order=desc')).toEqual([...asc].reverse());
  });

  it.each([['order=asc'], ['order=desc']])(
    'pages without a duplicate or missing row (%s)',
    async (order) => {
      const all = (await list(`?${order}&limit=100`)).items.map((r) => r.id);
      expect(all).toHaveLength(7);
      expect(await allPages(`${order}&limit=3`)).toEqual(all);
    },
  );

  it('rejects a malformed cursor, a cursor of another order and bad values', async () => {
    const { nextCursor } = await list('?limit=2');
    expect(nextCursor).not.toBeNull();
    await api.expectRejected('/internal/reviews?cursor=not-a-cursor');
    await api.expectRejected(
      `/internal/reviews?order=desc&cursor=${nextCursor}`,
    );
    await api.expectRejected('/internal/reviews?state=pending');
    await api.expectRejected('/internal/reviews?reason=NOPE');
    await api.expectRejected('/internal/reviews?sort=amount');
    await api.expectRejected('/internal/reviews?limit=0');
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list('?q=zzz')).toEqual({ items: [], nextCursor: null });
  });
});

describe('seeded data', () => {
  it('lists the seeded Reviews, open and closed, and summarises them', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    const open = (await list('?limit=100')).items;
    expect(new Set(open.map((r) => r.reason))).toEqual(new Set(REVIEW_REASONS));
    const mismatch = open.find((r) => r.reason === 'AMOUNT_MISMATCH');
    expect(mismatch?.providerReportedAmount).toBe('1250000');
    expect(open.some((r) => Date.parse(r.resolvableAt) < Date.now())).toBe(
      true,
    );
    expect(open.some((r) => Date.parse(r.resolvableAt) > Date.now())).toBe(
      true,
    );
    expect(open.some((r) => r.refundRequired)).toBe(true);

    const closed = (await list('?state=closed&limit=100')).items;
    expect(closed.length).toBeGreaterThanOrEqual(3);
    const sum = await summary();
    expect(sum.open).toBe(open.length);
    expect(sum.total).toBe(open.length + closed.length);
  });

  it('resolving a seeded Review through the existing route closes it', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    const before = await summary();
    const target = (await list('?reason=AMBIGUOUS_PROVIDER_STATUS')).items.find(
      (r) => Date.parse(r.resolvableAt) < Date.now(),
    );
    expect(target).toBeDefined();
    const res = await request(api.app.getHttpServer())
      .post(`/internal/payments/${target!.payment.id}/review-resolution`)
      .send({
        attemptId: target!.id,
        actor: 'ops.test',
        note: 'Confirmed in the provider dashboard',
        status: 'SUCCEEDED',
        amount: target!.payment.amount,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await summary();
    expect(after.open).toBe(before.open - 1);
    expect(after.total).toBe(before.total);
    expect(await refs('?limit=100')).not.toContain(
      target!.payment.upstreamReference,
    );
    const closed = (await list('?state=closed&limit=100')).items;
    expect(closed.find((r) => r.id === target!.id)).toMatchObject({
      state: 'closed',
      transactionStatus: 'SUCCEEDED',
    });
  });
});
