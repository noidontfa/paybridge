/**
 * The mocked Callbacks endpoints (`GET /internal/callbacks` and
 * `GET /internal/callbacks/:id`). The list leaves the body, headers and query
 * out; the detail adds them plus `paymentId`, which the server resolves from
 * the Attempt Key (null when the key matches no PaymentTransaction).
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { CALLBACK_STATUSES, type CallbackDetail, type CallbackListItem } from '@/features/callbacks/api';
import { BadQueryError, pageOf, readListWindow } from './payments-list';
import type { MockCallback, MockStore } from './store';

function toListItem(callback: MockCallback): CallbackListItem {
  const { headers: _headers, query: _query, rawBody: _rawBody, lastError: _lastError, ...item } = callback;
  return item;
}

export function toDetail(store: MockStore, callback: MockCallback): CallbackDetail {
  const attempt = callback.attemptKey ? store.attempts.find((a) => a.id === callback.attemptKey) : undefined;
  return { ...callback, paymentId: attempt?.paymentId ?? null };
}

export function queryCallbacks(store: MockStore, params: URLSearchParams) {
  const window = readListWindow(params);
  const status = params.get('status') || null;
  if (status && !CALLBACK_STATUSES.some((s) => s === status)) {
    throw new BadQueryError(`status must be one of ${CALLBACK_STATUSES.join(', ')}`);
  }
  const gatewayId = params.get('gatewayId') || null;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const matches = (c: MockCallback) => {
    const payment = store.getPayment(store.attempts.find((a) => a.id === c.attemptKey)?.paymentId ?? '');
    return [c.id, c.providerEventId, c.attemptKey, payment?.id, payment?.upstreamReference].some((value) => value?.toLowerCase().includes(q));
  };
  const rows = store.callbacks
    .filter((c) => !status || c.status === status)
    .filter((c) => !gatewayId || c.gatewayId === gatewayId)
    .filter((c) => !q || matches(c))
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || (a.id < b.id ? -1 : 1))
    .map(toListItem);
  return pageOf(rows, window);
}

export function callbacksHandlers(
  base: string,
  store: MockStore,
  badRequest: (request: Request, message: string) => Response,
  notFound: (request: Request, message: string) => Response,
): HttpHandler[] {
  return [
    http.get(`${base}/internal/callbacks`, ({ request }) => {
      try {
        return HttpResponse.json(queryCallbacks(store, new URL(request.url).searchParams));
      } catch (error) {
        if (error instanceof BadQueryError) return badRequest(request, error.message);
        throw error;
      }
    }),
    http.get(`${base}/internal/callbacks/:id`, ({ request, params }) => {
      const id = String(params.id);
      const callback = store.getCallback(id);
      if (!callback) return notFound(request, `Callback ${id} was not found`);
      return HttpResponse.json(toDetail(store, callback));
    }),
  ];
}
