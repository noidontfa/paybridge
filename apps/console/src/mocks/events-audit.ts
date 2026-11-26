/**
 * The mocked Payment Events (outbox) and status-transition (audit log)
 * endpoints. Both list newest first and use the shared cursor envelope from
 * `./payments-list`.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { AuditEntry } from '@/lib/api/status-transitions';
import {
  PAYMENT_EVENT_TYPES,
  STATUS_TRANSITION_ENTITY_TYPES,
  type StatusTransition,
} from '@/lib/api/schemas';
import { BadQueryError, pageOf, readListWindow } from './payments-list';
import type { MockStore } from './store';

/** Newest first; the id breaks ties so a page boundary never repeats or skips a row. */
function newestFirst(
  a: { id: string; createdAt: string },
  b: { id: string; createdAt: string },
): number {
  return (
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : 1)
  );
}

function oneOf<T extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T | null {
  const value = params.get(name);
  if (!value) return null;
  const match = allowed.find((a) => a === value);
  if (!match)
    throw new BadQueryError(`${name} must be one of ${allowed.join(', ')}`);
  return match;
}

export function queryPaymentEvents(store: MockStore, params: URLSearchParams) {
  const window = readListWindow(params);
  const type = oneOf(params, 'type', PAYMENT_EVENT_TYPES);
  const published = oneOf(params, 'published', ['true', 'false']);
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const matches = (e: (typeof store.events)[number]) =>
    [e.id, e.paymentId, store.getPayment(e.paymentId)?.upstreamReference].some(
      (value) => value?.toLowerCase().includes(q),
    );
  const rows = store.events
    .filter((e) => !type || e.type === type)
    .filter(
      (e) => !published || (e.publishedAt !== null) === (published === 'true'),
    )
    .filter((e) => !q || matches(e))
    .sort(newestFirst)
    .map(({ payload: _payload, ...summary }) => summary);
  return pageOf(rows, window);
}

/** The Payment a transition belongs to: its own id for a Payment, the attempt's Payment for a PaymentTransaction. */
function paymentIdOf(
  store: MockStore,
  transition: StatusTransition,
): string | null {
  if (transition.entityType === 'PAYMENT') return transition.entityId;
  if (transition.entityType === 'PAYMENT_TRANSACTION') {
    return (
      store.attempts.find((a) => a.id === transition.entityId)?.paymentId ??
      null
    );
  }
  return null;
}

export function queryStatusTransitions(
  store: MockStore,
  params: URLSearchParams,
) {
  const window = readListWindow(params);
  const entityType = oneOf(
    params,
    'entityType',
    STATUS_TRANSITION_ENTITY_TYPES,
  );
  const entityId = params.get('entityId') || null;
  const trigger = params.get('trigger') || null;
  const actor = params.get('actor') || null;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const matches = (t: StatusTransition) => {
    const paymentId = paymentIdOf(store, t);
    const reference = paymentId
      ? store.getPayment(paymentId)?.upstreamReference
      : undefined;
    return [t.entityId, paymentId, reference].some((value) =>
      value?.toLowerCase().includes(q),
    );
  };
  const rows = store.transitions
    .filter((t) => !entityType || t.entityType === entityType)
    .filter((t) => !entityId || t.entityId === entityId)
    .filter((t) => !trigger || t.trigger === trigger)
    .filter((t) => !actor || t.actor === actor)
    .filter((t) => !q || matches(t))
    .sort(newestFirst)
    .map((t): AuditEntry => ({ ...t, paymentId: paymentIdOf(store, t) }));
  return pageOf(rows, window);
}

export function eventsAuditHandlers(
  base: string,
  store: MockStore,
  badRequest: (request: Request, message: string) => Response,
  notFound: (request: Request, code: string, message: string) => Response,
): HttpHandler[] {
  const guard = (request: Request, run: () => Response): Response => {
    try {
      return run();
    } catch (error) {
      if (error instanceof BadQueryError)
        return badRequest(request, error.message);
      throw error;
    }
  };
  return [
    http.get(`${base}/internal/payment-events`, ({ request }) =>
      guard(request, () =>
        HttpResponse.json(
          queryPaymentEvents(store, new URL(request.url).searchParams),
        ),
      ),
    ),
    http.get(`${base}/internal/payment-events/:id`, ({ request, params }) => {
      const id = String(params.id);
      const event = store.events.find((e) => e.id === id);
      return event
        ? HttpResponse.json(event)
        : notFound(
            request,
            'PAYMENT_EVENT_NOT_FOUND',
            `Payment Event ${id} was not found`,
          );
    }),
    http.get(`${base}/internal/status-transitions`, ({ request }) =>
      guard(request, () =>
        HttpResponse.json(
          queryStatusTransitions(store, new URL(request.url).searchParams),
        ),
      ),
    ),
  ];
}
