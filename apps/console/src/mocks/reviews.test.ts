import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers } from './handlers';
import { MockStore, type MockAttempt, type MockPayment } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const HOUR = 3_600_000;
const BASE = 'http://api.test';
const at = (hoursAgo: number) =>
  new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();

function payment(id: string, amount = '100000'): MockPayment {
  const createdAt = at(200);
  return {
    id,
    upstreamReference: `order-${id}`,
    amount,
    currency: 'VND',
    status: 'PENDING',
    expiresAt: NOW.toISOString(),
    createdAt,
    updatedAt: createdAt,
  };
}

function review(
  id: string,
  paymentId: string,
  overrides: Partial<MockAttempt>,
): MockAttempt {
  return {
    id,
    paymentId,
    gatewayId: 'stripe',
    status: 'REQUIRES_REVIEW',
    providerRef: null,
    refundRequired: false,
    reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
    reviewOpenedAt: at(100),
    createdAt: at(150),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

const store = new MockStore(NOW);
store.payments.push(
  payment('p1'),
  payment('p2', '250000'),
  payment('p3'),
  payment('p4'),
  payment('p5'),
);
store.attempts.push(
  review('r-new', 'p1', { reviewOpenedAt: at(10) }),
  review('r-old', 'p2', {
    reviewOpenedAt: at(90),
    reviewReason: 'AMOUNT_MISMATCH',
    providerReportedAmount: '240000',
    refundRequired: true,
  }),
  review('r-fake', 'p3', {
    gatewayId: 'fake',
    reviewOpenedAt: at(50),
    reviewReason: 'DUPLICATE_SUCCESS',
    refundRequired: true,
  }),
  review('r-closed', 'p4', { status: 'FAILED', reviewOpenedAt: at(120) }),
  // Not a review at all.
  {
    id: 'plain',
    paymentId: 'p5',
    gatewayId: 'fake',
    status: 'PENDING',
    providerRef: null,
    refundRequired: false,
    createdAt: at(5),
    updatedAt: at(5),
  },
);

const server = setupServer(...createHandlers({ baseUrl: BASE, store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Item {
  id: string;
  reason: string;
  state: string;
  gatewayId: string;
  providerReportedAmount: string | null;
  resolvableAt: string;
  reviewOpenedAt: string;
  payment: {
    id: string;
    amount: string;
    upstreamReference: string;
    status: string;
  };
}
async function list(
  query = '',
): Promise<{ items: Item[]; nextCursor: string | null }> {
  const response = await fetch(`${BASE}/internal/reviews${query}`);
  expect(response.status).toBe(200);
  return response.json();
}
const ids = (page: { items: Item[] }) => page.items.map((i) => i.id);

describe('GET /internal/reviews', () => {
  it('lists open Reviews, oldest first, by default', async () => {
    expect(ids(await list())).toEqual(['r-old', 'r-fake', 'r-new']);
  });

  it('lists closed Reviews with state=closed', async () => {
    const page = await list('?state=closed');
    expect(ids(page)).toEqual(['r-closed']);
    expect(page.items[0]?.state).toBe('closed');
  });

  it('filters by reason and gateway', async () => {
    expect(ids(await list('?reason=AMOUNT_MISMATCH'))).toEqual(['r-old']);
    expect(ids(await list('?gatewayId=fake'))).toEqual(['r-fake']);
  });

  it('sorts newest first with order=desc', async () => {
    expect(ids(await list('?order=desc'))).toEqual([
      'r-new',
      'r-fake',
      'r-old',
    ]);
  });

  it('carries the Payment summary, the provider-reported amount and resolvableAt', async () => {
    const [mismatch, , fresh] = (await list()).items;
    expect(mismatch?.payment).toMatchObject({
      id: 'p2',
      amount: '250000',
      upstreamReference: 'order-p2',
      status: 'PENDING',
    });
    expect(mismatch?.providerReportedAmount).toBe('240000');
    expect(mismatch?.resolvableAt).toBe(at(90 - 72));
    expect(fresh?.providerReportedAmount).toBeNull();
    expect(fresh?.resolvableAt).toBe(at(10 - 72));
  });

  it('pages with a cursor', async () => {
    const first = await list('?limit=2');
    expect(ids(first)).toEqual(['r-old', 'r-fake']);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`?limit=2&cursor=${first.nextCursor}`);
    expect(ids(second)).toEqual(['r-new']);
    expect(second.nextCursor).toBeNull();
  });

  it.each(['?state=maybe', '?reason=NOPE', '?sort=amount', '?limit=0'])(
    'rejects %s with VALIDATION_FAILED',
    async (query) => {
      const response = await fetch(`${BASE}/internal/reviews${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    },
  );
});

describe('GET /internal/reviews/summary', () => {
  it('counts open Reviews, all Reviews and open Reviews by reason', async () => {
    const response = await fetch(`${BASE}/internal/reviews/summary`);
    expect(await response.json()).toEqual({
      open: 3,
      total: 4,
      byReason: {
        AMBIGUOUS_PROVIDER_STATUS: 1,
        AMOUNT_MISMATCH: 1,
        LATE_SUCCESS_ON_CLOSED_PAYMENT: 0,
        DUPLICATE_SUCCESS: 1,
      },
    });
  });
});
