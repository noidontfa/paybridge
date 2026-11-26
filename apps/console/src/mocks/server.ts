import 'server-only';
import { setupServer } from 'msw/node';
import { getEnvironment } from '@/lib/environment';
import { createHandlers } from './handlers';
import { isMockModeEnabled } from './mode';
import { createSeededStore } from './seed';
import type { MockStore } from './store';

// Next may load this module more than once (instrumentation and route bundles),
// so the single store and server live on globalThis.
const GLOBAL_KEY = Symbol.for('paybridge.console.mock-api');
interface MockApiState {
  store: MockStore;
  close: () => void;
}

/**
 * Starts MSW in Node over the seeded store when mock mode is on. It intercepts
 * the BFF's outgoing calls to the API base URL, so the browser code and the
 * BFF code are the same whether mocks are on or not. Idempotent.
 */
export function startMockApiIfEnabled(env: Record<string, string | undefined> = process.env): void {
  if (!isMockModeEnabled(env)) return;
  const registry = globalThis as Record<symbol, MockApiState | undefined>;
  if (registry[GLOBAL_KEY]) return;

  const store = createSeededStore();
  const server = setupServer(...createHandlers({ baseUrl: getEnvironment(env).apiBaseUrl, store }));
  server.listen({ onUnhandledFrame: 'bypass' });
  registry[GLOBAL_KEY] = { store, close: () => server.close() };
}
