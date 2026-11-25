/**
 * The mocked `POST /internal/payments/:id/review-resolution`. It applies the
 * rules Payment Core enforces (Payment Core spec, "Review exit"), mutates the
 * fixture store, and rejects with the API's error envelope:
 *
 * - 400 `VALIDATION_FAILED`: the body is malformed (actor, attempt id, note of
 *   1 to 2000 characters after trimming, `status` of SUCCEEDED or FAILED,
 *   `amount` a decimal string and required for SUCCEEDED);
 * - 404 `PAYMENT_NOT_FOUND`, `PAYMENT_TRANSACTION_NOT_FOUND`;
 * - 409 `REVIEW_NOT_OPEN`, `REVIEW_NOT_RESOLVABLE_YET` (under 72 hours),
 *   `PAYMENT_NOT_PENDING` (SUCCEEDED on a Payment that is not PENDING);
 * - 422 `AMOUNT_DOES_NOT_MATCH`, `RESOLUTION_NOT_ALLOWED` (for the review reason).
 *
 * Effects: the attempt becomes SUCCEEDED or FAILED (its review reason stays,
 * which keeps it a closed Review) with an `operator_resolution` transition; a
 * note-only request leaves the Review open and writes an `operator_note`
 * transition. Resolving to SUCCEEDED also succeeds the Payment, with its own
 * transition and an unpublished `PaymentSucceeded` Payment Event.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { z } from 'zod';
import { REVIEW_RESOLVABLE_AFTER_HOURS } from '@/lib/api/reviews';
import { REVIEW_NOTE_MAX_LENGTH } from '@/lib/api/review-resolution';
import { decimalStringSchema, type ReviewReason } from '@/lib/api/schemas';
import { compareDecimal } from '@/lib/decimal';
import type { MockAttempt, MockPayment, MockStore } from './store';

const HOUR = 3_600_000;


const bodySchema = z.object({
  attemptId: z.string().min(1, 'attemptId is required'),
  actor: z.string().trim().min(1, 'actor is required'),
  note: z.string().trim().min(1, 'note is required').max(REVIEW_NOTE_MAX_LENGTH, `note must be at most ${REVIEW_NOTE_MAX_LENGTH} characters`),
  status: z.enum(['SUCCEEDED', 'FAILED']).optional(),
  amount: decimalStringSchema.optional(),
});

interface Failure {
  status: number;
  error: string;
  code: string;
  message: string;
}
export type ErrorResponder = (request: Request, init: Failure) => Response;

const failure = (status: number, error: string, code: string, message: string): Failure => ({ status, error, code, message });
const unprocessable = (code: string, message: string) => failure(422, 'Unprocessable Entity', code, message);
const conflict = (code: string, message: string) => failure(409, 'Conflict', code, message);

/** The reasons an Operator may set a status on, and which statuses. */
const STATUSES_FOR: Record<ReviewReason, readonly string[]> = {
  AMBIGUOUS_PROVIDER_STATUS: ['SUCCEEDED', 'FAILED'],
  AMOUNT_MISMATCH: ['FAILED'],
  LATE_SUCCESS_ON_CLOSED_PAYMENT: [],
  DUPLICATE_SUCCESS: [],
};

export function resolveReview(
  store: MockStore,
  paymentId: string,
  rawBody: unknown,
): { ok: true; result: Record<string, string> } | { ok: false; failure: Failure } {
  const fail = (f: Failure) => ({ ok: false as const, failure: f });

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail(failure(400, 'Bad Request', 'VALIDATION_FAILED', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
  }
  const { attemptId, actor, note, status, amount } = parsed.data;
  if (status === 'SUCCEEDED' && amount === undefined) {
    return fail(failure(400, 'Bad Request', 'VALIDATION_FAILED', 'amount: amount is required to resolve to SUCCEEDED'));
  }

  const payment: MockPayment | undefined = store.getPayment(paymentId);
  if (!payment) return fail(failure(404, 'Not Found', 'PAYMENT_NOT_FOUND', `Payment ${paymentId} was not found`));
  const attempt: MockAttempt | undefined = store.attempts.find((a) => a.id === attemptId && a.paymentId === paymentId);
  if (!attempt) {
    return fail(failure(404, 'Not Found', 'PAYMENT_TRANSACTION_NOT_FOUND', `PaymentTransaction ${attemptId} was not found on Payment ${paymentId}`));
  }

  if (attempt.status !== 'REQUIRES_REVIEW' || !attempt.reviewReason || !attempt.reviewOpenedAt) {
    return fail(conflict('REVIEW_NOT_OPEN', 'This PaymentTransaction is not in Review any more.'));
  }
  const now = store.clock();
  if (Date.parse(attempt.reviewOpenedAt) + REVIEW_RESOLVABLE_AFTER_HOURS * HOUR > now.getTime()) {
    return fail(conflict('REVIEW_NOT_RESOLVABLE_YET', `A Review can be resolved only after it has been open for ${REVIEW_RESOLVABLE_AFTER_HOURS} hours.`));
  }

  const allowed = STATUSES_FOR[attempt.reviewReason];
  if (status ? !allowed.includes(status) : allowed.length > 0) {
    return fail(
      unprocessable(
        'RESOLUTION_NOT_ALLOWED',
        status
          ? `A ${attempt.reviewReason} Review cannot be resolved to ${status}.`
          : `A ${attempt.reviewReason} Review must be resolved to ${allowed.join(' or ')}; a note alone is not enough.`,
      ),
    );
  }
  if (status === 'SUCCEEDED') {
    if (payment.status !== 'PENDING') {
      return fail(conflict('PAYMENT_NOT_PENDING', `The Payment is no longer pending (it is ${payment.status}), so it cannot be marked succeeded.`));
    }
    if (compareDecimal(amount!, payment.amount) !== 0) {
      return fail(unprocessable('AMOUNT_DOES_NOT_MATCH', `The amount ${amount} does not equal the Payment Amount ${payment.amount}.`));
    }
  }

  const at = now.toISOString();
  const nextId = (prefix: string) => `${prefix}-${store.transitions.length + store.events.length + 1}-${now.getTime()}`;
  if (!status) {
    store.transitions.push({
      id: nextId('op-note'),
      entityType: 'PAYMENT_TRANSACTION',
      entityId: attempt.id,
      fromStatus: 'REQUIRES_REVIEW',
      toStatus: 'REQUIRES_REVIEW',
      trigger: 'operator_note',
      actor,
      reason: note,
      createdAt: at,
    });
    attempt.updatedAt = at;
    return { ok: true, result: { paymentId, attemptId, attemptStatus: attempt.status, paymentStatus: payment.status } };
  }

  store.transitions.push({
    id: nextId('op-res'),
    entityType: 'PAYMENT_TRANSACTION',
    entityId: attempt.id,
    fromStatus: 'REQUIRES_REVIEW',
    toStatus: status,
    trigger: 'operator_resolution',
    actor,
    reason: note,
    createdAt: at,
  });
  attempt.status = status;
  attempt.refundRequired = false;
  attempt.updatedAt = at;
  if (status === 'SUCCEEDED') {
    store.transitions.push({
      id: nextId('op-res-pay'),
      entityType: 'PAYMENT',
      entityId: payment.id,
      fromStatus: 'PENDING',
      toStatus: 'SUCCEEDED',
      trigger: 'operator_resolution',
      actor,
      reason: note,
      createdAt: at,
    });
    payment.status = 'SUCCEEDED';
    payment.updatedAt = at;
    store.events.push({
      id: nextId('op-event'),
      type: 'PaymentSucceeded',
      paymentId: payment.id,
      payload: { paymentId: payment.id, upstreamReference: payment.upstreamReference, status: 'SUCCEEDED' },
      createdAt: at,
      publishedAt: null,
    });
  }
  return { ok: true, result: { paymentId, attemptId, attemptStatus: attempt.status, paymentStatus: payment.status } };
}

export function reviewResolutionHandlers(base: string, store: MockStore, respond: ErrorResponder): HttpHandler[] {
  return [
    http.post(`${base}/internal/payments/:id/review-resolution`, async ({ request, params }) => {
      const body: unknown = await request.json().catch(() => undefined);
      const outcome = resolveReview(store, String(params.id), body);
      return outcome.ok ? HttpResponse.json(outcome.result) : respond(request, outcome.failure);
    }),
  ];
}
