import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentEvent, StatusTransition } from '@/lib/api/schemas';
import { createHandlers } from './handlers';
import { MockStore, type MockAttempt } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const BASE = 'http://api.test';
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const store = new MockStore(NOW);
store.attempts.push({
  id: 'att-1',
  paymentId: 'pay-1',
  gatewayId: 'stripe',
  status: 'SUCCEEDED',
  providerRef: null,
  refundRequired: false,
  createdAt: at(50),
  updatedAt: at(50),
} satisfies MockAttempt);

function event(id: string, type: PaymentEvent['type'], minutesAgo: number, published: boolean): PaymentEvent {
  return {
    id,
    type,
    paymentId: 'pay-1',
    payload: { amount: '1000' },
    createdAt: at(minutesAgo),
    publishedAt: published ? at(minutesAgo - 1) : null,
  };
}
store.events.push(
  event('e1', 'PaymentCreated', 60, true),
  event('e2', 'PaymentSucceeded', 30, false),
  event('e3', 'PaymentCreated', 10, false),
  event('e4', 'PaymentExpired', 5, true),
);

function transition(id: string, over: Partial<StatusTransition>, minutesAgo: number): StatusTransition {
  return {
    id,
    entityType: 'PAYMENT',
    entityId: 'pay-1',
    fromStatus: 'PENDING',
    toStatus: 'SUCCEEDED',
    trigger: 'webhook',
    actor: 'system',
    reason: null,
    createdAt: at(minutesAgo),
    ...over,
  };
}
store.transitions.push(
  transition('t1', { fromStatus: null, toStatus: 'PENDING', trigger: 'create_payment', actor: 'merchant' }, 60),
  transition('t2', { entityType: 'PAYMENT_TRANSACTION', entityId: 'att-1' }, 40),
  transition('t3', { trigger: 'operator_resolution', actor: 'operator', reason: 'Checked' }, 20),
  transition('t4', { entityType: 'REFUND', entityId: 'ref-1' }, 10),
);

const server = setupServer(...createHandlers({ baseUrl: BASE, store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: (await response.json()) as T };
}
const ids = (page: Page<{ id: string }>) => page.items.map((i) => i.id);

describe('GET /internal/payment-events', () => {
  const list = (query = '') => get<Page<PaymentEvent>>(`/internal/payment-events${query}`);

  it('lists newest first and leaves the payload for the detail', async () => {
    const { body } = await list();
    expect(ids(body)).toEqual(['e4', 'e3', 'e2', 'e1']);
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]).not.toHaveProperty('payload');
  });

  it('filters by type', async () => {
    expect(ids((await list('?type=PaymentCreated')).body)).toEqual(['e3', 'e1']);
  });

  it('filters published and unpublished', async () => {
    expect(ids((await list('?published=true')).body)).toEqual(['e4', 'e1']);
    expect(ids((await list('?published=false')).body)).toEqual(['e3', 'e2']);
    expect(ids((await list('?published=false&type=PaymentCreated')).body)).toEqual(['e3']);
  });

  it('pages with a cursor', async () => {
    const first = (await list('?limit=3')).body;
    expect(ids(first)).toEqual(['e4', 'e3', 'e2']);
    const second = (await list(`?limit=3&cursor=${first.nextCursor}`)).body;
    expect(ids(second)).toEqual(['e1']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects an unknown type or published value with the API error shape', async () => {
    const bad = await list('?type=Nope');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    expect((await list('?published=maybe')).status).toBe(400);
  });
});

describe('GET /internal/payment-events/:id', () => {
  it('returns the event with its payload', async () => {
    const { status, body } = await get<PaymentEvent>('/internal/payment-events/e2');
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: 'e2', type: 'PaymentSucceeded', payload: { amount: '1000' }, publishedAt: null });
  });

  it('answers 404 for an unknown id', async () => {
    const { status, body } = await get('/internal/payment-events/nope');
    expect(status).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, code: 'PAYMENT_EVENT_NOT_FOUND' });
  });
});

describe('GET /internal/status-transitions', () => {
  const list = (query = '') =>
    get<Page<StatusTransition & { paymentId: string | null }>>(`/internal/status-transitions${query}`);

  it('lists newest first and resolves each row to its Payment', async () => {
    const { body } = await list();
    expect(ids(body)).toEqual(['t4', 't3', 't2', 't1']);
    const byId = Object.fromEntries(body.items.map((t) => [t.id, t.paymentId]));
    // A Payment row is its own Payment; a PaymentTransaction row goes through its attempt; a Refund has none.
    expect(byId).toEqual({ t1: 'pay-1', t2: 'pay-1', t3: 'pay-1', t4: null });
  });

  it('filters by entity type, entity id, trigger and actor', async () => {
    expect(ids((await list('?entityType=PAYMENT_TRANSACTION')).body)).toEqual(['t2']);
    expect(ids((await list('?entityId=att-1')).body)).toEqual(['t2']);
    expect(ids((await list('?trigger=operator_resolution')).body)).toEqual(['t3']);
    expect(ids((await list('?actor=merchant')).body)).toEqual(['t1']);
    expect(ids((await list('?entityType=PAYMENT&actor=operator')).body)).toEqual(['t3']);
  });

  it('pages with a cursor', async () => {
    const first = (await list('?limit=3')).body;
    expect(ids(first)).toEqual(['t4', 't3', 't2']);
    expect(ids((await list(`?limit=3&cursor=${first.nextCursor}`)).body)).toEqual(['t1']);
  });

  it('rejects an unknown entity type', async () => {
    const bad = await list('?entityType=Nope');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
