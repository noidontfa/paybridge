import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers } from './handlers';
import { MockStore, type MockAttempt, type MockPayment } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const HOUR = 3_600_000;
const BASE = 'http://api.test';
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();

function build() {
  const store = new MockStore(NOW);
  store.clock = () => NOW;
  const payment = (id: string, status: MockPayment['status'] = 'PENDING', amount = '100000'): MockPayment => ({
    id,
    upstreamReference: `order-${id}`,
    amount,
    currency: 'VND',
    status,
    expiresAt: at(-5),
    createdAt: at(200),
    updatedAt: at(100),
  });
  const review = (id: string, paymentId: string, overrides: Partial<MockAttempt> = {}): MockAttempt => ({
    id,
    paymentId,
    gatewayId: 'stripe',
    status: 'REQUIRES_REVIEW',
    providerRef: null,
    refundRequired: true,
    reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
    reviewOpenedAt: at(100),
    createdAt: at(150),
    updatedAt: at(100),
    ...overrides,
  });
  store.payments.push(payment('p-amb'), payment('p-mis'), payment('p-late', 'EXPIRED'), payment('p-young'), payment('p-done', 'CANCELLED'));
  store.attempts.push(
    review('a-amb', 'p-amb'),
    review('a-mis', 'p-mis', { reviewReason: 'AMOUNT_MISMATCH', providerReportedAmount: '90000' }),
    review('a-late', 'p-late', { reviewReason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' }),
    review('a-young', 'p-young', { reviewOpenedAt: at(10) }),
    review('a-done', 'p-done', { status: 'FAILED' }),
  );
  return store;
}

let store = build();
const server = setupServer(...createHandlers({ baseUrl: BASE, store: new Proxy({} as MockStore, { get: (_t, key) => Reflect.get(store, key) }) }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  store = build();
});
afterAll(() => server.close());

async function resolve(paymentId: string, body: Record<string, unknown>) {
  const response = await fetch(`${BASE}/internal/payments/${paymentId}/review-resolution`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'op-1', ...body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe('POST /internal/payments/:id/review-resolution', () => {
  it('resolves an ambiguous Review to FAILED: the attempt fails, the Payment stays PENDING, the audit trail has actor and note', async () => {
    const result = await resolve('p-amb', { attemptId: 'a-amb', status: 'FAILED', note: 'Checked with the provider' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ paymentId: 'p-amb', attemptId: 'a-amb', attemptStatus: 'FAILED', paymentStatus: 'PENDING' });
    const attempt = store.attempts.find((a) => a.id === 'a-amb')!;
    expect(attempt.status).toBe('FAILED');
    expect(attempt.reviewReason).toBe('AMBIGUOUS_PROVIDER_STATUS');
    expect(attempt.refundRequired).toBe(false);
    expect(store.transitionsOf('a-amb')).toEqual([
      expect.objectContaining({
        entityType: 'PAYMENT_TRANSACTION',
        fromStatus: 'REQUIRES_REVIEW',
        toStatus: 'FAILED',
        trigger: 'operator_resolution',
        actor: 'op-1',
        reason: 'Checked with the provider',
        createdAt: NOW.toISOString(),
      }),
    ]);
    expect(store.eventsOf('p-amb')).toEqual([]);
    expect(store.getPayment('p-amb')!.status).toBe('PENDING');
  });

  it('resolves to SUCCEEDED: the Payment succeeds too, with a Payment transition and an unpublished PaymentSucceeded event', async () => {
    const result = await resolve('p-amb', { attemptId: 'a-amb', status: 'SUCCEEDED', amount: '100000', note: 'Money seen in the dashboard' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ attemptStatus: 'SUCCEEDED', paymentStatus: 'SUCCEEDED' });
    expect(store.getPayment('p-amb')).toMatchObject({ status: 'SUCCEEDED', updatedAt: NOW.toISOString() });
    expect(store.transitionsOf('p-amb')).toEqual([
      expect.objectContaining({
        entityType: 'PAYMENT',
        fromStatus: 'PENDING',
        toStatus: 'SUCCEEDED',
        trigger: 'operator_resolution',
        actor: 'op-1',
        reason: 'Money seen in the dashboard',
      }),
    ]);
    expect(store.eventsOf('p-amb')).toEqual([
      expect.objectContaining({
        type: 'PaymentSucceeded',
        paymentId: 'p-amb',
        publishedAt: null,
        payload: expect.objectContaining({ paymentId: 'p-amb', status: 'SUCCEEDED' }),
      }),
    ]);
  });

  it('accepts an equal amount written with trailing zeros', async () => {
    const result = await resolve('p-amb', { attemptId: 'a-amb', status: 'SUCCEEDED', amount: '100000.00', note: 'ok' });
    expect(result.status).toBe(200);
  });

  it('adds a note only: the Review stays open and an operator_note transition is written', async () => {
    const result = await resolve('p-late', { attemptId: 'a-late', note: 'Refund will be done by hand' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ attemptStatus: 'REQUIRES_REVIEW', paymentStatus: 'EXPIRED' });
    expect(store.attempts.find((a) => a.id === 'a-late')!.status).toBe('REQUIRES_REVIEW');
    expect(store.transitionsOf('a-late')).toEqual([
      expect.objectContaining({
        fromStatus: 'REQUIRES_REVIEW',
        toStatus: 'REQUIRES_REVIEW',
        trigger: 'operator_note',
        actor: 'op-1',
        reason: 'Refund will be done by hand',
      }),
    ]);
    expect(store.eventsOf('p-late')).toEqual([]);
  });

  it.each([
    ['no actor', { attemptId: 'a-amb', status: 'FAILED', note: 'n', actor: '' }],
    ['no attempt id', { status: 'FAILED', note: 'n' }],
    ['a blank note', { attemptId: 'a-amb', status: 'FAILED', note: '   ' }],
    ['a note over 2000 characters', { attemptId: 'a-amb', status: 'FAILED', note: 'x'.repeat(2001) }],
    ['an unknown status', { attemptId: 'a-amb', status: 'PENDING', note: 'n' }],
    ['SUCCEEDED without an amount', { attemptId: 'a-amb', status: 'SUCCEEDED', note: 'n' }],
    ['a malformed amount', { attemptId: 'a-amb', status: 'SUCCEEDED', amount: '1e5', note: 'n' }],
  ])('rejects %s with 400 VALIDATION_FAILED', async (_name, body) => {
    const result = await resolve('p-amb', body);
    expect(result).toMatchObject({ status: 400, body: { statusCode: 400, code: 'VALIDATION_FAILED' } });
    expect(store.attempts.find((a) => a.id === 'a-amb')!.status).toBe('REQUIRES_REVIEW');
  });

  it('answers 404 for an unknown Payment or an attempt that is not on it', async () => {
    expect(await resolve('nope', { attemptId: 'a-amb', status: 'FAILED', note: 'n' })).toMatchObject({
      status: 404,
      body: { code: 'PAYMENT_NOT_FOUND' },
    });
    expect(await resolve('p-amb', { attemptId: 'a-mis', status: 'FAILED', note: 'n' })).toMatchObject({
      status: 404,
      body: { code: 'ATTEMPT_NOT_FOUND' },
    });
  });

  it('answers 409 when the attempt is not in Review any more', async () => {
    const result = await resolve('p-done', { attemptId: 'a-done', status: 'FAILED', note: 'n' });
    expect(result).toMatchObject({ status: 409, body: { code: 'ATTEMPT_NOT_IN_REVIEW' } });
  });

  it('accepts a note on a late-success Review that has been open for less than 72 hours', async () => {
    store.attempts.find((a) => a.id === 'a-late')!.reviewOpenedAt = at(1);
    const result = await resolve('p-late', { attemptId: 'a-late', note: 'Will refund by hand' });
    expect(result.status).toBe(200);
  });

  it('answers 409 before the Review has been open for 72 hours', async () => {
    const result = await resolve('p-young', { attemptId: 'a-young', status: 'FAILED', note: 'n' });
    expect(result).toMatchObject({ status: 409, body: { code: 'REVIEW_WINDOW_OPEN' } });
    expect(result.body.message).toContain('72 hours');
  });

  it('answers 409 REVIEW_RESOLUTION_NOT_ALLOWED for SUCCEEDED when the Payment is no longer PENDING', async () => {
    store.getPayment('p-amb')!.status = 'EXPIRED';
    const result = await resolve('p-amb', { attemptId: 'a-amb', status: 'SUCCEEDED', amount: '100000', note: 'n' });
    expect(result).toMatchObject({ status: 409, body: { code: 'REVIEW_RESOLUTION_NOT_ALLOWED' } });
    expect(result.body.message).toContain('PENDING Payment');
  });

  it('answers 409 when the amount differs from the Payment Amount', async () => {
    const result = await resolve('p-amb', { attemptId: 'a-amb', status: 'SUCCEEDED', amount: '99999', note: 'n' });
    expect(result).toMatchObject({ status: 409, body: { code: 'REVIEW_RESOLUTION_NOT_ALLOWED' } });
    expect(store.attempts.find((a) => a.id === 'a-amb')!.status).toBe('REQUIRES_REVIEW');
  });

  it.each([
    ['AMOUNT_MISMATCH to SUCCEEDED', 'p-mis', { attemptId: 'a-mis', status: 'SUCCEEDED', amount: '100000', note: 'n' }],
    ['a late success to FAILED', 'p-late', { attemptId: 'a-late', status: 'FAILED', note: 'n' }],
    ['an ambiguous Review to a note only', 'p-amb', { attemptId: 'a-amb', note: 'n' }],
  ])('answers 409 REVIEW_RESOLUTION_NOT_ALLOWED for %s', async (_name, paymentId, body) => {
    const result = await resolve(paymentId, body);
    expect(result).toMatchObject({ status: 409, body: { code: 'REVIEW_RESOLUTION_NOT_ALLOWED' } });
  });
});
