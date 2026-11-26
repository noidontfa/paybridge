/**
 * The mocked Reviews endpoints. A Review is a PaymentTransaction that has a
 * review reason: open while it is `REQUIRES_REVIEW`, closed after it has been
 * resolved. Reuses the list window and error plumbing of the Payments list.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { REVIEW_REASONS } from '@/lib/api/schemas';
import {
  REVIEW_RESOLVABLE_AFTER_HOURS,
  REVIEW_SORT_COLUMNS,
  REVIEW_STATES,
  type ReviewItem,
  type ReviewState,
  type ReviewSummary,
} from '@/lib/api/reviews';
import { BadQueryError, pageOf, readListWindow } from './payments-list';
import type { MockAttempt, MockStore } from './store';

const HOUR = 3_600_000;

function stateOf(attempt: MockAttempt): ReviewState {
  return attempt.status === 'REQUIRES_REVIEW' ? 'open' : 'closed';
}

function reviewsOf(store: MockStore): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const attempt of store.attempts) {
    const payment = store.getPayment(attempt.paymentId);
    if (!attempt.reviewReason || !attempt.reviewOpenedAt || !payment) continue;
    const { id, upstreamReference, amount, currency, status } = payment;
    items.push({
      id: attempt.id,
      reason: attempt.reviewReason,
      state: stateOf(attempt),
      gatewayId: attempt.gatewayId,
      transactionStatus: attempt.status,
      refundRequired: attempt.refundRequired,
      reviewOpenedAt: attempt.reviewOpenedAt,
      resolvableAt: new Date(
        Date.parse(attempt.reviewOpenedAt) +
          REVIEW_RESOLVABLE_AFTER_HOURS * HOUR,
      ).toISOString(),
      providerReportedAmount: attempt.providerReportedAmount ?? null,
      payment: { id, upstreamReference, amount, currency, status },
    });
  }
  return items;
}

export function queryReviews(store: MockStore, params: URLSearchParams) {
  const window = readListWindow(params);
  const state = params.get('state') || 'open';
  if (!REVIEW_STATES.some((s) => s === state))
    throw new BadQueryError(`state must be one of ${REVIEW_STATES.join(', ')}`);
  const reason = params.get('reason') || null;
  if (reason && !REVIEW_REASONS.some((r) => r === reason)) {
    throw new BadQueryError(
      `reason must be one of ${REVIEW_REASONS.join(', ')}`,
    );
  }
  const gatewayId = params.get('gatewayId') || null;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const sort = params.get('sort') ?? REVIEW_SORT_COLUMNS[0];
  if (!REVIEW_SORT_COLUMNS.some((column) => column === sort)) {
    throw new BadQueryError(
      `sort must be one of ${REVIEW_SORT_COLUMNS.join(', ')}`,
    );
  }
  const direction = params.get('order') === 'desc' ? -1 : 1;

  const rows = reviewsOf(store)
    .filter((r) => r.state === state)
    .filter((r) => !reason || r.reason === reason)
    .filter((r) => !gatewayId || r.gatewayId === gatewayId)
    .filter(
      (r) =>
        !q ||
        [r.payment.id, r.payment.upstreamReference, r.id].some((value) =>
          value.toLowerCase().includes(q),
        ),
    )
    // The id breaks ties so a page boundary never repeats or skips a row.
    .sort(
      (a, b) =>
        direction *
          (Date.parse(a.reviewOpenedAt) - Date.parse(b.reviewOpenedAt)) ||
        (a.id < b.id ? -1 : 1),
    );
  return pageOf(rows, window);
}

export function summarizeReviews(store: MockStore): ReviewSummary {
  const all = reviewsOf(store);
  const open = all.filter((r) => r.state === 'open');
  const byReason = Object.fromEntries(
    REVIEW_REASONS.map((reason) => [
      reason,
      open.filter((r) => r.reason === reason).length,
    ]),
  );
  return { open: open.length, total: all.length, byReason } as ReviewSummary;
}

export function reviewHandlers(
  base: string,
  store: MockStore,
  badRequest: (request: Request, message: string) => Response,
): HttpHandler[] {
  return [
    http.get(`${base}/internal/reviews/summary`, () =>
      HttpResponse.json(summarizeReviews(store)),
    ),
    http.get(`${base}/internal/reviews`, ({ request }) => {
      try {
        return HttpResponse.json(
          queryReviews(store, new URL(request.url).searchParams),
        );
      } catch (error) {
        if (error instanceof BadQueryError)
          return badRequest(request, error.message);
        throw error;
      }
    }),
  ];
}
