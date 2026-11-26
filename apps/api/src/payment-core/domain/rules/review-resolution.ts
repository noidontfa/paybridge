import { parseAmount } from '../value-objects/amount.js';
import {
  AttemptNotInReviewError,
  ReviewResolutionNotAllowedError,
  ReviewWindowOpenError,
} from '../errors.js';
import type { Payment } from '../entities/payment.js';
import type { PaymentTransaction } from '../entities/payment-transaction.js';
import { REVIEW_REQUERY_WINDOW_MS } from './review-requery.js';

/** The status an operator may set on a review. */
export type OperatorResolutionStatus = 'SUCCEEDED' | 'FAILED';

export interface ReviewResolutionRequest {
  readonly payment: Payment;
  readonly attempt: PaymentTransaction;
  /** Absent: the operator only adds a note. */
  readonly status?: OperatorResolutionStatus;
  /** The amount the operator confirmed with the provider; needed for `SUCCEEDED`. */
  readonly amount?: string;
  readonly now: Date;
}

export type ReviewResolutionDecision =
  | { readonly kind: 'note' }
  | { readonly kind: 'fail' }
  | { readonly kind: 'succeed' };

/**
 * When an Operator may first set a status on a Review that opened at
 * `openedAt`: once the automatic re-query window has passed.
 */
export function reviewResolvableAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + REVIEW_REQUERY_WINDOW_MS);
}

/**
 * Operator resolution rules (spec: Payment states and rules, review exit).
 * Throws a domain error when the request would create an invalid state.
 *
 * - Only an attempt in `REQUIRES_REVIEW` can be resolved.
 * - `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` accept notes
 *   only, at any time (a refund flow will close them later).
 * - Other reviews can be resolved after 72 hours (the re-query window).
 * - `FAILED` is always allowed; `SUCCEEDED` needs an amount equal to the
 *   Payment amount, a `PENDING` Payment, and a reason other than
 *   `AMOUNT_MISMATCH` (a mismatch can only be failed).
 */
export function decideReviewResolution(
  request: ReviewResolutionRequest,
): ReviewResolutionDecision {
  const { payment, attempt, status, amount, now } = request;
  if (attempt.status !== 'REQUIRES_REVIEW') {
    throw new AttemptNotInReviewError(attempt.id, attempt.status);
  }

  const reason = attempt.reviewReason;
  if (
    reason === 'LATE_SUCCESS_ON_CLOSED_PAYMENT' ||
    reason === 'DUPLICATE_SUCCESS'
  ) {
    if (status !== undefined) {
      throw new ReviewResolutionNotAllowedError(
        `A ${reason} review accepts notes only; its status cannot be changed until refunds exist`,
      );
    }
    return { kind: 'note' };
  }

  if (status === undefined) {
    throw new ReviewResolutionNotAllowedError(
      `A ${reason ?? 'review'} resolution needs a status (SUCCEEDED or FAILED)`,
    );
  }

  const opened = attempt.reviewOpenedAt;
  const eligibleAt = reviewResolvableAt(opened ?? now);
  if (!opened || now.getTime() < eligibleAt.getTime()) {
    throw new ReviewWindowOpenError(attempt.id, eligibleAt);
  }

  if (status === 'FAILED') return { kind: 'fail' };

  if (reason === 'AMOUNT_MISMATCH') {
    throw new ReviewResolutionNotAllowedError(
      'An AMOUNT_MISMATCH review can only be set to FAILED',
    );
  }
  if (payment.status !== 'PENDING') {
    throw new ReviewResolutionNotAllowedError(
      `Payment ${payment.id} is ${payment.status}; SUCCEEDED needs a PENDING Payment`,
    );
  }
  if (amount === undefined) {
    throw new ReviewResolutionNotAllowedError(
      'SUCCEEDED needs the amount the provider collected',
    );
  }
  const confirmed = parseAmount(amount, payment.currency);
  const expected = parseAmount(payment.amount, payment.currency);
  if (confirmed.value !== expected.value) {
    throw new ReviewResolutionNotAllowedError(
      `Amount ${confirmed.value} differs from the Payment amount ${expected.value}; SUCCEEDED needs them equal`,
    );
  }
  return { kind: 'succeed' };
}
