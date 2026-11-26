/**
 * MSW handlers: the mocked API. One handler set over one `MockStore`, used by
 * the BFF in mock mode and by screen tests (with `baseUrl` pointed at the BFF
 * prefix, because the BFF preserves paths).
 *
 * Extension point: add a handler to the array in `createHandlers`. Answer
 * success with `HttpResponse.json(...)` and failure with `apiError(...)` so
 * every error has the API's envelope.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { apiKeysHandlers } from './api-keys';
import { eventsAuditHandlers } from './events-audit';
import { callbacksHandlers } from './callbacks';
import { gatewayConnectionsHandlers } from './gateway-connections';
import { gatewaysHandlers } from './gateways';
import { invitationsHandlers } from './invitations';
import { paymentsListHandlers } from './payments-list';
import { reviewHandlers } from './reviews';
import { reviewResolutionHandlers } from './review-resolution';
import { platformHandlers } from './platform';
import { pricingPlansHandlers } from './pricing-plans';
import { pricingTablesHandlers } from './pricing-tables';
import { publishableKeysHandlers } from './publishable-keys';
import { usersHandlers } from './users';
import { OVERVIEW_RANGES } from '@/lib/overview-range';
import { computeOverview } from './overview';
import type { MockStore } from './store';

export interface HandlerOptions {
  /** Where the API is, or the BFF prefix (with a wildcard origin) for a screen test. */
  baseUrl: string;
  store: MockStore;
}

/** The API's error envelope (apps/api AllExceptionsFilter). */
export function apiError(
  request: Request,
  init: { status: number; error: string; code?: string; message: string; details?: unknown },
  now: Date,
) {
  const url = new URL(request.url);
  return HttpResponse.json(
    {
      statusCode: init.status,
      error: init.error,
      message: init.message,
      ...(init.code && { code: init.code }),
      ...(init.details !== undefined && { details: init.details }),
      path: url.pathname + url.search,
      method: request.method,
      timestamp: now.toISOString(),
      requestId: 'mock-request',
    },
    { status: init.status },
  );
}

export function createHandlers({ baseUrl, store }: HandlerOptions): HttpHandler[] {
  const base = baseUrl.replace(/\/$/, '');
  return [
    ...paymentsListHandlers(base, store, (request, message) =>
      apiError(request, { status: 400, error: 'Bad Request', code: 'VALIDATION_FAILED', message }, store.now),
    ),
    ...eventsAuditHandlers(
      base,
      store,
      (request, message) =>
        apiError(request, { status: 400, error: 'Bad Request', code: 'VALIDATION_FAILED', message }, store.now),
      (request, code, message) => apiError(request, { status: 404, error: 'Not Found', code, message }, store.now),
    ),
    ...reviewHandlers(base, store, (request, message) =>
      apiError(request, { status: 400, error: 'Bad Request', code: 'VALIDATION_FAILED', message }, store.now),
    ),
    ...reviewResolutionHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...callbacksHandlers(
      base,
      store,
      (request, message) =>
        apiError(request, { status: 400, error: 'Bad Request', code: 'VALIDATION_FAILED', message }, store.now),
      (request, message) =>
        apiError(request, { status: 404, error: 'Not Found', code: 'CALLBACK_NOT_FOUND', message }, store.now),
    ),
    ...platformHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...apiKeysHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...pricingPlansHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...pricingTablesHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...publishableKeysHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...usersHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...invitationsHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...gatewayConnectionsHandlers(base, store, (request, init) => apiError(request, init, store.now)),
    ...gatewaysHandlers(base, store, (request, message) =>
      apiError(request, { status: 404, error: 'Not Found', code: 'GATEWAY_NOT_FOUND', message }, store.now),
    ),
    http.get(`${base}/internal/overview`, ({ request }) => {
      const range = new URL(request.url).searchParams.get('range');
      const valid = OVERVIEW_RANGES.find((r) => r === range);
      if (!valid) {
        return apiError(
          request,
          { status: 400, error: 'Bad Request', code: 'INVALID_RANGE', message: `range must be one of ${OVERVIEW_RANGES.join(', ')}` },
          store.now,
        );
      }
      return HttpResponse.json(computeOverview(store, valid));
    }),
    http.get(`${base}/internal/payments/:id`, ({ request, params }) => {
      const id = String(params.id);
      const payment = store.getOperatorPayment(id);
      if (!payment) {
        return apiError(
          request,
          { status: 404, error: 'Not Found', code: 'PAYMENT_NOT_FOUND', message: `Payment ${id} was not found` },
          store.now,
        );
      }
      return HttpResponse.json(payment);
    }),
  ];
}
