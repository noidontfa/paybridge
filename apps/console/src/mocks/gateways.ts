/**
 * The mocked Gateways endpoints. Registration, mode and Callback URL come from
 * the store's gateways; the health figures are derived from its Callbacks over
 * the 24 hours before `store.now`. The error category is read off a failed
 * Callback's last error (the real API classifies it server side).
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { GatewayDetail, GatewaySummary } from '@/lib/api/gateways';
import type { MockStore } from './store';

const DAY_MS = 24 * 3_600_000;

const CATEGORIES: { category: string; pattern: RegExp }[] = [
  { category: 'SIGNATURE_INVALID', pattern: /signature/i },
  { category: 'PROVIDER_UNAVAILABLE', pattern: /\b50\d\b|unavailable/i },
  { category: 'TIMEOUT', pattern: /timed? ?out|lock/i },
];

export function errorCategory(message: string): string {
  return CATEGORIES.find((c) => c.pattern.test(message))?.category ?? 'UNKNOWN';
}

function toSummary(gateway: GatewaySummary): GatewaySummary {
  const { id, registered, configured, mode, callbackUrl } = gateway;
  return { id, registered, configured, mode, callbackUrl };
}

export function gatewayDetail(store: MockStore, gateway: GatewaySummary): GatewayDetail {
  const since = store.now.getTime() - DAY_MS;
  const own = store.callbacks.filter((c) => c.gatewayId === gateway.id);
  const recent = own.filter((c) => Date.parse(c.receivedAt) > since);
  const callbackCounts = { RECEIVED: 0, PROCESSING: 0, PROCESSED: 0, FAILED: 0 };
  for (const c of recent) callbackCounts[c.status] += 1;

  const byCategory = new Map<string, number>();
  for (const c of recent) {
    if (c.status === 'FAILED' && c.lastError) {
      const category = errorCategory(c.lastError);
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
  }
  const recentErrors = [...byCategory]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));

  const last = own.reduce<string | null>((latest, c) => (latest === null || c.receivedAt > latest ? c.receivedAt : latest), null);
  return { ...toSummary(gateway), callbackCounts, lastCallbackAt: last, recentErrors };
}

export function gatewaysHandlers(
  base: string,
  store: MockStore,
  notFound: (request: Request, message: string) => Response,
): HttpHandler[] {
  return [
    http.get(`${base}/internal/gateways`, () =>
      HttpResponse.json({ items: store.gateways.map(toSummary).sort((a, b) => (a.id < b.id ? -1 : 1)) }),
    ),
    http.get(`${base}/internal/gateways/:id`, ({ request, params }) => {
      const id = String(params.id);
      const gateway = store.gateways.find((g) => g.id === id);
      if (!gateway) return notFound(request, `Gateway ${id} was not found`);
      return HttpResponse.json(gatewayDetail(store, gateway));
    }),
  ];
}
