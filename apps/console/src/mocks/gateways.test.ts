import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gatewayDetailSchema, gatewayListSchema } from '@/lib/api/gateways';
import { createHandlers } from './handlers';
import { createSeededStore } from './seed';
import { MockStore, type MockCallback } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const BASE = 'http://api.test';
const HOUR = 3_600_000;

function callback(n: number, hoursAgo: number, overrides: Partial<MockCallback> = {}): MockCallback {
  return {
    id: `cb-${n}`,
    gatewayId: 'stripe',
    providerEventId: `evt_${n}`,
    attemptKey: null,
    status: 'PROCESSED',
    attempts: 1,
    receivedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    processedAt: null,
    headers: {},
    query: {},
    rawBody: '{}',
    lastError: null,
    ...overrides,
  };
}

const store = new MockStore(NOW);
store.callbacks.push(
  callback(1, 1),
  callback(2, 2),
  callback(3, 3, { status: 'FAILED', lastError: 'Signature verification failed' }),
  callback(4, 4, { status: 'FAILED', lastError: 'Signature verification failed' }),
  callback(5, 5, { status: 'FAILED', lastError: 'Provider status query returned 503' }),
  callback(6, 30, { status: 'FAILED', lastError: 'Signature verification failed' }), // outside 24h
  callback(7, 0.5, { gatewayId: 'fake', status: 'RECEIVED' }),
);

const empty = new MockStore(NOW);
const custom = new MockStore(NOW);
custom.gateways.splice(0, custom.gateways.length, {
  id: 'stripe',
  registered: true,
  configured: false,
  mode: 'live',
  callbackUrl: 'https://x.test/webhooks/stripe',
});

const server = setupServer(
  ...createHandlers({ baseUrl: BASE, store }),
  ...createHandlers({ baseUrl: 'http://empty.test', store: empty }),
  ...createHandlers({ baseUrl: 'http://custom.test', store: custom }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
const get = (path: string, base = BASE) => fetch(`${base}${path}`);

describe('GET /internal/gateways', () => {
  it('lists stripe and fake with registration, mode and Callback URL', async () => {
    const list = gatewayListSchema.parse(await (await get('/internal/gateways')).json());
    expect(list.items.map((g) => g.id)).toEqual(['fake', 'stripe']);
    expect(list.items[1]).toMatchObject({ registered: true, configured: true, mode: 'test' });
    expect(list.items[1]!.callbackUrl).toMatch(/\/webhooks\/stripe$/);
    expect(JSON.stringify(list)).not.toMatch(/secret|apiKey/i);
  });

  it('reports what the store says, not a fixed value', async () => {
    const list = gatewayListSchema.parse(await (await get('/internal/gateways', 'http://custom.test')).json());
    expect(list.items).toEqual([
      { id: 'stripe', registered: true, configured: false, mode: 'live', callbackUrl: 'https://x.test/webhooks/stripe' },
    ]);
  });
});

describe('GET /internal/gateways/:id', () => {
  it('counts Callbacks by status in the last 24 hours, the last Callback time and errors by category', async () => {
    const detail = gatewayDetailSchema.parse(await (await get('/internal/gateways/stripe')).json());
    expect(detail.callbackCounts).toEqual({ RECEIVED: 0, PROCESSING: 0, PROCESSED: 2, FAILED: 3 });
    expect(detail.lastCallbackAt).toBe(new Date(NOW.getTime() - 1 * HOUR).toISOString());
    expect(detail.recentErrors).toEqual([
      { category: 'SIGNATURE_INVALID', count: 2 },
      { category: 'PROVIDER_UNAVAILABLE', count: 1 },
    ]);
  });

  it('has an empty health for a gateway that sent nothing', async () => {
    const detail = gatewayDetailSchema.parse(await (await get('/internal/gateways/fake', 'http://empty.test')).json());
    expect(detail.callbackCounts).toEqual({ RECEIVED: 0, PROCESSING: 0, PROCESSED: 0, FAILED: 0 });
    expect(detail.lastCallbackAt).toBeNull();
    expect(detail.recentErrors).toEqual([]);
  });

  it('answers 404 GATEWAY_NOT_FOUND', async () => {
    const response = await get('/internal/gateways/vnpay');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_NOT_FOUND' });
  });
});

describe('seeded gateways', () => {
  it('are stripe and fake only', () => {
    const seeded = createSeededStore();
    expect(seeded.gateways.map((g) => g.id).sort()).toEqual(['fake', 'stripe']);
  });
});
