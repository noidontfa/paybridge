import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callbackDetailSchema,
  callbackListSchema,
  CALLBACK_STATUSES,
} from '@/lib/api/callbacks';
import { createHandlers } from './handlers';
import { createSeededStore } from './seed';
import { MockStore, type MockCallback } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const BASE = 'http://api.test';

function callback(
  n: number,
  overrides: Partial<MockCallback> = {},
): MockCallback {
  return {
    id: `cb-${n}`,
    gatewayId: 'stripe',
    providerEventId: `evt_${n}`,
    attemptKey: null,
    status: 'PROCESSED',
    attempts: 1,
    receivedAt: new Date(NOW.getTime() - n * 60_000).toISOString(),
    processedAt: new Date(NOW.getTime() - n * 60_000 + 1000).toISOString(),
    headers: { 'content-type': 'application/json' },
    query: {},
    rawBody: '{"ok":true}',
    lastError: null,
    ...overrides,
  };
}

const store = new MockStore(NOW);
store.payments.push({
  id: 'pay-1',
  upstreamReference: 'order-1',
  amount: '1000',
  currency: 'VND',
  status: 'PENDING',
  expiresAt: NOW.toISOString(),
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});
store.attempts.push({
  id: 'att-1',
  paymentId: 'pay-1',
  gatewayId: 'stripe',
  status: 'PENDING',
  providerRef: null,
  refundRequired: false,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});
store.callbacks.push(
  callback(1, { attemptKey: 'att-1' }),
  callback(2, {
    gatewayId: 'fake',
    status: 'FAILED',
    attempts: 3,
    lastError: 'boom',
    processedAt: null,
    providerEventId: null,
  }),
  callback(3, { status: 'RECEIVED', processedAt: null, attempts: 0 }),
  callback(4, { attemptKey: 'unknown-key' }),
);

const server = setupServer(...createHandlers({ baseUrl: BASE, store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const get = (path: string) => fetch(`${BASE}${path}`);

describe('GET /internal/callbacks', () => {
  it('lists Callbacks newest first, without bodies', async () => {
    const page = callbackListSchema.parse(
      await (await get('/internal/callbacks')).json(),
    );
    expect(page.items.map((c) => c.id)).toEqual([
      'cb-1',
      'cb-2',
      'cb-3',
      'cb-4',
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[1]).toMatchObject({
      gatewayId: 'fake',
      status: 'FAILED',
      attempts: 3,
      providerEventId: null,
    });
    expect(page.items[0]).not.toHaveProperty('rawBody');
  });

  it('filters by gatewayId and status, and pages with a cursor', async () => {
    const fake = callbackListSchema.parse(
      await (await get('/internal/callbacks?gatewayId=fake')).json(),
    );
    expect(fake.items.map((c) => c.id)).toEqual(['cb-2']);
    const failed = callbackListSchema.parse(
      await (
        await get('/internal/callbacks?status=FAILED&gatewayId=stripe')
      ).json(),
    );
    expect(failed.items).toEqual([]);

    const first = callbackListSchema.parse(
      await (await get('/internal/callbacks?limit=3')).json(),
    );
    expect(first.items).toHaveLength(3);
    const second = callbackListSchema.parse(
      await (
        await get(`/internal/callbacks?limit=3&cursor=${first.nextCursor}`)
      ).json(),
    );
    expect(second.items.map((c) => c.id)).toEqual(['cb-4']);
  });

  it('rejects an unknown status with 400 VALIDATION_FAILED', async () => {
    const response = await get('/internal/callbacks?status=NOPE');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('GET /internal/callbacks/:id', () => {
  it('returns headers, query, raw body, last error, and the Payment when the Attempt Key matches', async () => {
    const known = callbackDetailSchema.parse(
      await (await get('/internal/callbacks/cb-1')).json(),
    );
    expect(known).toMatchObject({
      rawBody: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
      paymentId: 'pay-1',
    });
    const unknown = callbackDetailSchema.parse(
      await (await get('/internal/callbacks/cb-4')).json(),
    );
    expect(unknown).toMatchObject({
      attemptKey: 'unknown-key',
      paymentId: null,
    });
    const failed = callbackDetailSchema.parse(
      await (await get('/internal/callbacks/cb-2')).json(),
    );
    expect(failed.lastError).toBe('boom');
  });

  it('answers 404 CALLBACK_NOT_FOUND', async () => {
    const response = await get('/internal/callbacks/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'CALLBACK_NOT_FOUND' });
  });
});

describe('seeded Callbacks', () => {
  const seeded = createSeededStore();
  it('cover every inbox status, only stripe and fake, and include unknown Attempt Keys', () => {
    expect(new Set(seeded.callbacks.map((c) => c.status))).toEqual(
      new Set(CALLBACK_STATUSES),
    );
    expect(new Set(seeded.callbacks.map((c) => c.gatewayId))).toEqual(
      new Set(['stripe', 'fake']),
    );
    const unknown = seeded.callbacks.filter(
      (c) =>
        c.attemptKey && !seeded.attempts.some((a) => a.id === c.attemptKey),
    );
    expect(unknown.length).toBeGreaterThan(0);
    expect(
      seeded.callbacks.some((c) => c.status === 'FAILED' && c.lastError),
    ).toBe(true);
    expect(
      seeded.callbacks.some(
        (c) =>
          c.attemptKey && seeded.attempts.some((a) => a.id === c.attemptKey),
      ),
    ).toBe(true);
    expect(
      seeded.callbacks.some((c) => !c.rawBody.trim().startsWith('{')),
    ).toBe(true);
  });
});
