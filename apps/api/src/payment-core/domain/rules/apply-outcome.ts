import type { NormalizedOutcome } from '../../port/index.js';
import { parseAmount } from '../amount.js';
import type { Payment } from '../payment.js';
import type { PaymentTransaction } from '../payment-transaction.js';
import type { ReviewReason } from '../statuses.js';
import { isOpenAttempt } from './attempt-transitions.js';

// What a provider-reported outcome (callback or status query) does to one
// attempt (spec: Payment states and rules, Late success and review). Pure:
// the application layer (`application/apply-provider-outcome.ts`) carries the
// decision out under the Payment lock.

/** The parts of the locked Payment aggregate the rule reads. */
export interface OutcomeSubject {
  readonly payment: Pick<Payment, 'status' | 'amount' | 'currency'> & {
    readonly attempts: readonly Pick<PaymentTransaction, 'id' | 'status'>[];
  };
  /** The attempt the provider reported on (its Attempt Key). */
  readonly attemptId: string;
}

/**
 * - `succeed`: attempt and Payment move to `SUCCEEDED`.
 * - `fail`: the attempt moves to `FAILED`; the Payment stays as it is.
 * - `review`: the attempt moves to `REQUIRES_REVIEW` with `reason`.
 * - `no-change`: nothing moves. `still-pending`: the provider has no final
 *   answer yet. `already-applied`: a repeat of the state the attempt is in.
 *   `already-closed`: a failure for an attempt Core already closed.
 *   `not-handled`: a result this rule does not decide yet (a result on an
 *   attempt already in review: review exit, tickets 28/29).
 */
export type OutcomeDecision =
  | { readonly kind: 'succeed' }
  | { readonly kind: 'fail' }
  | { readonly kind: 'review'; readonly reason: ReviewReason }
  | {
      readonly kind: 'no-change';
      readonly reason:
        'still-pending' | 'already-applied' | 'already-closed' | 'not-handled';
    };

const noChange = (
  reason: Extract<OutcomeDecision, { kind: 'no-change' }>['reason'],
): OutcomeDecision => ({ kind: 'no-change', reason });

export function decideOutcome(
  { payment, attemptId }: OutcomeSubject,
  outcome: NormalizedOutcome,
): OutcomeDecision {
  const attempt = payment.attempts.find((a) => a.id === attemptId);
  if (!attempt) {
    throw new Error(`Attempt ${attemptId} is not an attempt of this Payment`);
  }

  if (attempt.status === outcome.status) return noChange('already-applied');
  // A succeeded attempt never moves again (invariant 7 and audit).
  if (attempt.status === 'SUCCEEDED') return noChange('already-applied');

  if (!isOpenAttempt(attempt.status)) {
    // REQUIRES_REVIEW, FAILED, EXPIRED, CANCELLED.
    if (attempt.status === 'REQUIRES_REVIEW') return noChange('not-handled');
    // Late success (FAILED, EXPIRED, CANCELLED): promoted only when safe,
    // else review. Never dropped.
    if (outcome.status === 'SUCCEEDED') {
      return decideSuccess(payment, attemptId, outcome.amount);
    }
    return noChange('already-closed');
  }

  switch (outcome.status) {
    case 'PENDING':
      return noChange('still-pending');
    case 'FAILED':
      return { kind: 'fail' };
    case 'REQUIRES_REVIEW':
      return { kind: 'review', reason: 'AMBIGUOUS_PROVIDER_STATUS' };
    case 'SUCCEEDED':
      return decideSuccess(payment, attemptId, outcome.amount);
  }
}

function decideSuccess(
  payment: OutcomeSubject['payment'],
  attemptId: string,
  amount: string | null,
): OutcomeDecision {
  // Closed-payment and duplicate reasons first: they are never re-queried
  // into a promotion, while AMOUNT_MISMATCH is.
  if (payment.status !== 'PENDING') {
    const other = payment.attempts.some(
      (a) => a.id !== attemptId && a.status === 'SUCCEEDED',
    );
    return {
      kind: 'review',
      reason: other ? 'DUPLICATE_SUCCESS' : 'LATE_SUCCESS_ON_CLOSED_PAYMENT',
    };
  }
  if (payment.attempts.some((a) => a.status === 'SUCCEEDED')) {
    return { kind: 'review', reason: 'DUPLICATE_SUCCESS' };
  }
  // Invariant 9: SUCCEEDED only with the Payment amount. A missing amount
  // cannot be checked, so it is treated as a mismatch.
  if (!sameAmount(amount, payment.amount, payment.currency)) {
    return { kind: 'review', reason: 'AMOUNT_MISMATCH' };
  }
  return { kind: 'succeed' };
}

function sameAmount(
  reported: string | null,
  expected: string,
  currency: string,
): boolean {
  if (reported === null) return false;
  try {
    return (
      parseAmount(reported, currency).value ===
      parseAmount(expected, currency).value
    );
  } catch {
    return false;
  }
}
