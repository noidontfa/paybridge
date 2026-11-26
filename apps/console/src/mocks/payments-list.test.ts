import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers } from './handlers';
import { MockStore, type MockAttempt, type MockPayment } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const BASE = 'http://api.test';

function payment(n: number, overrides: Partial<MockPayment> = {}): MockPayment {
  const createdAt = new Date(NOW.getTime() - n * 3_600_000).toISOString();
  return {
    id: `pay-${n}`,
    upstreamReference: `order-${n}`,
    amount: String(n * 1000),
    currency: 'VND',
    status: 'PENDING',
    expiresAt: NOW.toISOString(),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function attempt(id: string, paymentId: string, gatewayId: string, createdAt: string, status: MockAttempt['status'] = 'PENDING'): MockAttempt {
  return { id, paymentId, gatewayId, status, providerRef: null, refundRequired: false, createdAt, updatedAt: createdAt };
}

const store = new MockStore(NOW);
store.payments.push(
  payment(1),
  payment(2, { status: 'SUCCEEDED', amount: '999999999999999999.5' }),
  payment(3, { status: 'SUCCEEDED' }),
  payment(4, { upstreamReference: 'INV-Alpha' }),
  payment(5),
);
store.attempts.push(
  attempt('a1', 'pay-1', 'stripe', payment(1).createdAt),
  attempt('a2a', 'pay-2', 'stripe', '2026-11-25T00:00:00.000Z', 'FAILED'),
  attempt('a2b', 'pay-2', 'fake', '2026-11-25T01:00:00.000Z', 'SUCCEEDED'),
  attempt('a3', 'pay-3', 'fake', payment(3).createdAt, 'SUCCEEDED'),
);

const server = setupServer(...createHandlers({ baseUrl: BASE, store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Page {
  items: { id: string; latestTransaction: { gatewayId: string; status: string } | null }[];
  nextCursor: string | null;
}

async function list(query = ''): Promise<{ status: number; body: Page }> {
  const response = await fetch(`${BASE}/internal/payments${query}`);
  return { status: response.status, body: (await response.json()) as Page };
}
const ids = (page: Page) => page.items.map((i) => i.id);

describe('GET /internal/payments', () => {
  it('lists newest first with the latest transaction of each Payment', async () => {
    const { body } = await list();
    expect(ids(body)).toEqual(['pay-1', 'pay-2', 'pay-3', 'pay-4', 'pay-5']);
    expect(body.nextCursor).toBeNull();
    expect(body.items[1]?.latestTransaction).toEqual({ gatewayId: 'fake', status: 'SUCCEEDED' });
    expect(body.items[3]?.latestTransaction).toBeNull();
  });

  it('filters by status', async () => {
    expect(ids((await list('?status=SUCCEEDED')).body)).toEqual(['pay-2', 'pay-3']);
  });

  it('filters by the gateway of any transaction', async () => {
    expect(ids((await list('?gatewayId=stripe')).body)).toEqual(['pay-1', 'pay-2']);
  });

  it('combines filters', async () => {
    expect(ids((await list('?gatewayId=stripe&status=SUCCEEDED')).body)).toEqual(['pay-2']);
  });

  it('searches the id or the Upstream Reference, ignoring case', async () => {
    expect(ids((await list('?q=pay-3')).body)).toEqual(['pay-3']);
    expect(ids((await list('?q=inv-alpha')).body)).toEqual(['pay-4']);
  });

  it('filters by created date, both ends inclusive of the day', async () => {
    // pay-1 is 02:00 on the 25th, pay-2 01:00, pay-3 00:00, pay-4 is 23:00 on the 24th.
    expect(ids((await list('?createdFrom=2026-11-25')).body)).toEqual(['pay-1', 'pay-2', 'pay-3']);
    expect(ids((await list('?createdTo=2026-11-24&createdFrom=2026-11-24')).body)).toEqual(['pay-4', 'pay-5']);
  });

  it('sorts by created time ascending', async () => {
    expect(ids((await list('?sort=createdAt&order=asc')).body)).toEqual(['pay-5', 'pay-4', 'pay-3', 'pay-2', 'pay-1']);
  });

  it('sorts by amount as a number, not as text', async () => {
    expect(ids((await list('?sort=amount&order=desc')).body)).toEqual(['pay-2', 'pay-5', 'pay-4', 'pay-3', 'pay-1']);
    expect(ids((await list('?sort=amount&order=asc')).body)).toEqual(['pay-1', 'pay-3', 'pay-4', 'pay-5', 'pay-2']);
  });

  it('pages with a cursor and a limit, without gaps or repeats', async () => {
    const first = (await list('?limit=2')).body;
    expect(ids(first)).toEqual(['pay-1', 'pay-2']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await list(`?limit=2&cursor=${first.nextCursor}`)).body;
    expect(ids(second)).toEqual(['pay-3', 'pay-4']);
    const third = (await list(`?limit=2&cursor=${second.nextCursor}`)).body;
    expect(ids(third)).toEqual(['pay-5']);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects an invalid cursor or sort with the API error shape', async () => {
    const bad = await list('?cursor=%25%25');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ statusCode: 400 });
    expect((await list('?sort=nope')).status).toBe(400);
  });
});
