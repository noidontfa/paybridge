import { type AttemptStatus, OPEN_ATTEMPT_STATUSES } from '../statuses.js';

// The attempt (PaymentTransaction) state table (spec: Payment states and
// rules). It says which moves exist; the conditions on each move (amount
// equals the Payment amount, late-success rules, provider confirmed unpaid,
// ...) belong to the use case or rule that makes it.

/** Every attempt is stored in this state before the gateway is called. */
export const INITIAL_ATTEMPT_STATUS: AttemptStatus = 'CREATED';

const ALLOWED: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  // Gateway accepted / rejected synchronously; a callback or query result
  // (story 29: a webhook for a CREATED attempt is accepted); gateway switch.
  CREATED: ['PENDING', 'FAILED', 'SUCCEEDED', 'REQUIRES_REVIEW', 'CANCELLED'],
  PENDING: ['SUCCEEDED', 'FAILED', 'REQUIRES_REVIEW', 'EXPIRED', 'CANCELLED'],
  // Late success: promoted, or sent to review.
  FAILED: ['SUCCEEDED', 'REQUIRES_REVIEW'],
  EXPIRED: ['SUCCEEDED', 'REQUIRES_REVIEW'],
  CANCELLED: ['SUCCEEDED', 'REQUIRES_REVIEW'],
  // Review exit: a clear re-query answer or an operator resolution.
  REQUIRES_REVIEW: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
};

export function canTransitionAttempt(
  from: AttemptStatus,
  to: AttemptStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/** `CREATED` or `PENDING`: at most one per Payment (invariant 6a). */
export function isOpenAttempt(status: AttemptStatus): boolean {
  return OPEN_ATTEMPT_STATUSES.includes(status);
}
