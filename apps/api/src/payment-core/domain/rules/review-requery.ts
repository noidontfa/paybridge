import type { PaymentTransaction } from '../entities/payment-transaction.js';
import { REQUERIED_REVIEW_REASONS } from './apply-outcome.js';

/** After this long in review without a clear answer, an operator decides. */
export const REVIEW_REQUERY_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Whether an attempt in review is still re-queried automatically (ticket 28):
 * it is in `REQUIRES_REVIEW` for a reason a provider answer can settle, and
 * its review opened less than 72 hours ago. `LATE_SUCCESS_ON_CLOSED_PAYMENT`
 * and `DUPLICATE_SUCCESS` are never re-queried.
 */
export function isReviewRequeryEligible(
  attempt: Pick<
    PaymentTransaction,
    'status' | 'reviewReason' | 'reviewOpenedAt'
  >,
  now: Date,
): boolean {
  if (attempt.status !== 'REQUIRES_REVIEW') return false;
  if (
    !attempt.reviewReason ||
    !REQUERIED_REVIEW_REASONS.includes(attempt.reviewReason)
  ) {
    return false;
  }
  if (!attempt.reviewOpenedAt) return false;
  return (
    now.getTime() - attempt.reviewOpenedAt.getTime() < REVIEW_REQUERY_WINDOW_MS
  );
}
