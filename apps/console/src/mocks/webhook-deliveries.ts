/**
 * The mocked Webhook deliveries endpoints (`/internal/webhook-deliveries`,
 * resend, and `POST /internal/webhook-endpoints/:id/test`). The seed gives the
 * mock Organization two Webhook Endpoints, one healthy and one failing, and a
 * delivery of each recent Payment Event to them. The mocked receiver answers
 * 200, except the failing endpoint, which answers 500 until a resend.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { PaymentEvent } from '@/features/payments/schemas';
import {
  WEBHOOK_DELIVERY_KINDS,
  WEBHOOK_DELIVERY_STATUSES,
  type WebhookDeliveryAttempt,
  type WebhookDeliveryDetail,
  type WebhookDeliveryListItem,
} from '@/features/webhooks/api/webhook-deliveries';
import type { WebhookEndpoint } from '@/features/webhooks/api/webhook-endpoints';
import { BadQueryError, pageOf, readListWindow } from './payments-list';
import type { MockStore } from './store';

type ErrorInit = { status: number; error: string; code: string; message: string };

export const SEED_ENDPOINTS = {
  erp: 'endpoint-seed-erp',
  crm: 'endpoint-seed-crm',
} as const;

const KIND_OF: Record<string, string> = {
  PaymentCreated: 'payment.created',
  PaymentSucceeded: 'payment.succeeded',
  PaymentCancelled: 'payment.cancelled',
  PaymentExpired: 'payment.expired',
  PaymentRequiresReview: 'payment.requires_review',
};

const MOCK_ADMIN = { name: 'Mock Admin', role: 'ORGANIZATION_ADMIN', label: null };
/** Who the mock says resent or test-sent something. */
const MOCK_REQUESTER = { name: 'Mock Operator', role: 'OPERATOR', label: null };

function endpoint(id: string, url: string, at: string): WebhookEndpoint {
  return {
    id,
    url,
    eventKinds: ['payment.created', 'payment.succeeded', 'payment.cancelled', 'payment.expired', 'payment.requires_review'],
    status: 'ENABLED',
    secretPrefix: 'whsec_pb_mock12',
    previousSecretExpiresAt: null,
    createdAt: at,
    updatedAt: at,
    updatedBy: MOCK_ADMIN,
  };
}

const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** Seeds two endpoints and a delivery of the 12 newest Payment Events to each (less than a page). */
export function seedWebhookDeliveries(store: MockStore): void {
  const created = plusMs(store.now.toISOString(), -30 * 24 * 3600_000);
  store.webhookEndpoints.push(
    endpoint(SEED_ENDPOINTS.erp, 'https://erp.example.test/paybridge/webhooks', created),
    endpoint(SEED_ENDPOINTS.crm, 'https://crm.example.test/hooks/paybridge', created),
  );
  const events = [...store.events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12);
  events.forEach((event, index) => {
    store.webhookDeliveries.push(delivery(event, SEED_ENDPOINTS.erp, index, true));
    store.webhookDeliveries.push(delivery(event, SEED_ENDPOINTS.crm, index, false));
  });
}

function delivery(event: PaymentEvent, endpointId: string, index: number, healthy: boolean): WebhookDeliveryDetail {
  const url = endpointId === SEED_ENDPOINTS.erp ? 'https://erp.example.test/paybridge/webhooks' : 'https://crm.example.test/hooks/paybridge';
  const at = plusMs(event.createdAt, 1500);
  const history: WebhookDeliveryAttempt[] = healthy
    ? [{ id: `${event.id}-${endpointId}-1`, attemptedAt: at, succeeded: true, httpStatus: 200, durationMs: 80 + index, responseBody: 'ok', error: null, triggeredBy: null }]
    : [
        {
          id: `${event.id}-${endpointId}-1`,
          attemptedAt: at,
          succeeded: false,
          httpStatus: 500,
          durationMs: 240 + index,
          responseBody: '{"error":"database unavailable"}',
          error: 'HTTP 500',
          triggeredBy: null,
        },
      ];
  return {
    id: `delivery-${event.id}-${endpointId === SEED_ENDPOINTS.erp ? 'erp' : 'crm'}`,
    endpoint: { id: endpointId, url },
    eventId: event.id,
    eventKind: KIND_OF[event.type] ?? event.type,
    paymentId: event.paymentId,
    status: healthy ? 'SUCCEEDED' : 'FAILED',
    attempts: history.length,
    lastAttemptAt: at,
    lastHttpStatus: history[0]!.httpStatus,
    createdAt: plusMs(event.createdAt, 1000),
    eventCreatedAt: event.createdAt,
    history,
  };
}

export function toListItem(detail: WebhookDeliveryDetail): WebhookDeliveryListItem {
  const { history: _history, eventCreatedAt: _eventCreatedAt, ...item } = detail;
  return item;
}

export function queryWebhookDeliveries(store: MockStore, params: URLSearchParams) {
  const window = readListWindow(params);
  const status = params.get('status') || null;
  if (status && !WEBHOOK_DELIVERY_STATUSES.some((s) => s === status)) {
    throw new BadQueryError(`status must be one of ${WEBHOOK_DELIVERY_STATUSES.join(', ')}`);
  }
  const kind = params.get('kind') || null;
  if (kind && !WEBHOOK_DELIVERY_KINDS.some((k) => k === kind)) {
    throw new BadQueryError(`kind must be one of ${WEBHOOK_DELIVERY_KINDS.join(', ')}`);
  }
  const endpointId = params.get('endpointId') || null;
  const paymentId = params.get('paymentId') || null;
  const rows = store.webhookDeliveries
    .filter((d) => !status || d.status === status)
    .filter((d) => !kind || d.eventKind === kind)
    .filter((d) => !endpointId || d.endpoint.id === endpointId)
    .filter((d) => !paymentId || d.paymentId === paymentId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))
    .map(toListItem);
  return pageOf(rows, window);
}

/** Whether the endpoint's latest three attempts all failed (the API's rule). */
export function isFailingEndpoint(store: MockStore, endpointId: string): boolean {
  const latest = store.webhookDeliveries
    .filter((d) => d.endpoint.id === endpointId)
    .flatMap((d) => d.history)
    .sort((a, b) => (a.attemptedAt < b.attemptedAt ? 1 : -1))
    .slice(0, 3);
  return latest.length === 3 && latest.every((a) => !a.succeeded);
}

/** A mocked POST: the seeded failing endpoint is fixed by the time anyone resends. */
function attemptNow(store: MockStore, id: string, requester: WebhookDeliveryAttempt['triggeredBy']): WebhookDeliveryAttempt {
  return {
    id,
    attemptedAt: store.clock().toISOString(),
    succeeded: true,
    httpStatus: 200,
    durationMs: 64,
    responseBody: 'ok',
    error: null,
    triggeredBy: requester,
  };
}

function recordAttempt(delivery: WebhookDeliveryDetail, attempt: WebhookDeliveryAttempt): void {
  delivery.history.unshift(attempt);
  delivery.attempts += 1;
  delivery.lastAttemptAt = attempt.attemptedAt;
  delivery.lastHttpStatus = attempt.httpStatus;
  if (attempt.succeeded) delivery.status = 'SUCCEEDED';
}

export function webhookDeliveriesHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: ErrorInit) => Response,
): HttpHandler[] {
  const notFound = (request: Request, id: string) =>
    error(request, { status: 404, error: 'Not Found', code: 'WEBHOOK_DELIVERY_NOT_FOUND', message: `Webhook delivery ${id} not found` });
  const find = (id: string) => store.webhookDeliveries.find((d) => d.id === id);

  return [
    http.get(`${base}/internal/webhook-deliveries`, ({ request }) => {
      try {
        return HttpResponse.json(queryWebhookDeliveries(store, new URL(request.url).searchParams));
      } catch (e) {
        if (e instanceof BadQueryError) {
          return error(request, { status: 400, error: 'Bad Request', code: 'VALIDATION_FAILED', message: e.message });
        }
        throw e;
      }
    }),
    http.get(`${base}/internal/webhook-deliveries/:id`, ({ request, params }) => {
      const found = find(String(params.id));
      return found ? HttpResponse.json(found) : notFound(request, String(params.id));
    }),
    http.post(`${base}/internal/webhook-deliveries/:id/resend`, ({ request, params }) => {
      const found = find(String(params.id));
      if (!found) return notFound(request, String(params.id));
      recordAttempt(found, attemptNow(store, `${found.id}-resend-${found.attempts + 1}`, MOCK_REQUESTER));
      return HttpResponse.json(found);
    }),
    http.post(`${base}/internal/webhook-endpoints/:id/test`, ({ request, params }) => {
      const target = store.webhookEndpoints.find((e) => e.id === String(params.id));
      if (!target) {
        return error(request, { status: 404, error: 'Not Found', code: 'WEBHOOK_ENDPOINT_NOT_FOUND', message: 'Webhook Endpoint not found' });
      }
      const now = store.clock().toISOString();
      const id = `delivery-test-${store.webhookDeliveries.length + 1}`;
      const attempt = attemptNow(store, `${id}-1`, MOCK_ADMIN);
      const test: WebhookDeliveryDetail = {
        id,
        endpoint: { id: target.id, url: target.url },
        eventId: `event-test-${store.webhookDeliveries.length + 1}`,
        eventKind: 'webhook.test',
        paymentId: null,
        status: 'SUCCEEDED',
        attempts: 1,
        lastAttemptAt: now,
        lastHttpStatus: 200,
        createdAt: now,
        eventCreatedAt: now,
        history: [attempt],
      };
      store.webhookDeliveries.push(test);
      return HttpResponse.json(test);
    }),
  ];
}
