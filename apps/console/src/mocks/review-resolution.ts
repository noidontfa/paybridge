/**
 * The mocked `POST /internal/payments/:id/review-resolution`. It applies the
 * rules Payment Core enforces (Payment Core spec, "Review exit"), mutates the
 * fixture store, and rejects with the API's error envelope:
 *
 * - 400 `VALIDATION_FAILED`: the body is malformed (attempt id, note of
 *   1 to 2000 characters after trimming, `status` of SUCCEEDED or FAILED,
 *   `amount` a decimal string and required for SUCCEEDED);
 * - 404 `PAYMENT_NOT_FOUND`, `ATTEMPT_NOT_FOUND`;
 * - 409, the codes and order of Core's `decideReviewResolution`:
 *   `ATTEMPT_NOT_IN_REVIEW`; `REVIEW_RESOLUTION_NOT_ALLOWED` (a status on a
 *   late-success or duplicate-success Review, which takes notes only, at any
 *   time; a note only on the other reasons; SUCCEEDED on `AMOUNT_MISMATCH`, on
 *   a Payment that is not PENDING, or with an amount that differs);
 *   `REVIEW_WINDOW_OPEN` (a status resolution under 72 hours).
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
import { decimalStringSchema } from '@/features/payments/schemas';
import { compareDecimal } from '@/utils/decimal';
import type { MockAttempt, MockPayment, MockStore } from './store';

const HOUR = 3_600_000;


const bodySchema = z.object({
  attemptId: z.string().min(1, 'attemptId is required'),
  // The real API takes the actor from the signed-in User's token, not the body;
  // mock mode has no sign-in, so it falls back to the mock identity.
  actor: z.string().trim().min(1, 'actor must not be empty').default('operator'),
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
const notAllowed = (message: string) => conflict('REVIEW_RESOLUTION_NOT_ALLOWED', message);
const conflict = (code: string, message: string) => failure(409, 'Conflict', code, message);

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
    return fail(failure(404, 'Not Found', 'ATTEMPT_NOT_FOUND', `Payment ${paymentId} has no attempt ${attemptId}`));
  }

  if (attempt.status !== 'REQUIRES_REVIEW' || !attempt.reviewReason || !attempt.reviewOpenedAt) {
    return fail(conflict('ATTEMPT_NOT_IN_REVIEW', `Attempt ${attempt.id} is ${attempt.status}, not REQUIRES_REVIEW`));
  }
  const now = store.clock();
  const reason = attempt.reviewReason;

  // The order of Core's `decideReviewResolution`.
  if (reason === 'LATE_SUCCESS_ON_CLOSED_PAYMENT' || reason === 'DUPLICATE_SUCCESS') {
    if (status !== undefined) {
      return fail(notAllowed(`A ${reason} review accepts notes only; its status cannot be changed until refunds exist`));
    }
    // Notes on these are accepted at any time: no 72-hour wait.
  } else {
    if (status === undefined) {
      return fail(notAllowed(`A ${reason} resolution needs a status (SUCCEEDED or FAILED)`));
    }
    if (Date.parse(attempt.reviewOpenedAt) + REVIEW_RESOLVABLE_AFTER_HOURS * HOUR > now.getTime()) {
      return fail(conflict('REVIEW_WINDOW_OPEN', `A Review can be resolved by an operator only after it has been open for ${REVIEW_RESOLVABLE_AFTER_HOURS} hours.`));
    }
    if (status === 'SUCCEEDED') {
      if (reason === 'AMOUNT_MISMATCH') return fail(notAllowed('An AMOUNT_MISMATCH review can only be set to FAILED'));
      if (payment.status !== 'PENDING') {
        return fail(notAllowed(`Payment ${payment.id} is ${payment.status}; SUCCEEDED needs a PENDING Payment`));
      }
      if (compareDecimal(amount!, payment.amount) !== 0) {
        return fail(notAllowed(`Amount ${amount} differs from the Payment amount ${payment.amount}; SUCCEEDED needs them equal`));
      }
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
