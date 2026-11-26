import type { NormalizedOutcome } from '../../port/index.js';
import { parseAmount } from '../value-objects/amount.js';
import type { Payment } from '../entities/payment.js';
import type { PaymentTransaction } from '../entities/payment-transaction.js';
import type { ReviewReason } from '../statuses.js';
import { isOpenAttempt } from './attempt-transitions.js';

// What a provider-reported outcome (callback or status query) does to one
// attempt (spec: Payment states and rules, Late success and review). Pure:
// the application layer (`application/apply-provider-outcome.ts`) carries the
// decision out under the Payment lock.

/** The parts of the locked Payment aggregate the rule reads. */
export interface OutcomeSubject {
  readonly payment: Pick<Payment, 'status' | 'amount' | 'currency'> & {
    readonly attempts: readonly (Pick<PaymentTransaction, 'id' | 'status'> & {
      /** Needed only to decide results on an attempt in review. */
      readonly reviewReason?: ReviewReason | null;
    })[];
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
 *   `still-in-review`: an attempt in an automatically re-queried review got
 *   no clear answer (pending, unclear, or a success that is still a
 *   mismatch or otherwise unsafe): it stays in review.
 *   `not-handled`: a result this rule does not decide: a result on an attempt
 *   in review whose reason is not re-queried (`LATE_SUCCESS_ON_CLOSED_PAYMENT`,
 *   `DUPLICATE_SUCCESS`; those wait for an operator, ticket 29).
 */
export type OutcomeDecision =
  | { readonly kind: 'succeed' }
  | { readonly kind: 'fail' }
  | { readonly kind: 'review'; readonly reason: ReviewReason }
  | {
      readonly kind: 'no-change';
      readonly reason:
        | 'still-pending'
        | 'already-applied'
        | 'already-closed'
        | 'still-in-review'
        | 'not-handled';
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
    if (attempt.status === 'REQUIRES_REVIEW') {
      return decideReviewExit(
        payment,
        attemptId,
        attempt.reviewReason,
        outcome,
      );
    }
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

/** Reasons whose review is re-queried and closed by a clear provider answer. */
export const REQUERIED_REVIEW_REASONS: readonly ReviewReason[] = [
  'AMBIGUOUS_PROVIDER_STATUS',
  'AMOUNT_MISMATCH',
];

/**
 * Review exit by a clear provider answer (ticket 28). A clear success goes
 * through the normal success rule (so it promotes only when safe), a clear
 * failure fails the attempt. Anything else, including a success that would
 * itself need review, leaves the attempt in review under its own reason.
 */
function decideReviewExit(
  payment: OutcomeSubject['payment'],
  attemptId: string,
  reviewReason: ReviewReason | null | undefined,
  outcome: NormalizedOutcome,
): OutcomeDecision {
  if (!reviewReason || !REQUERIED_REVIEW_REASONS.includes(reviewReason)) {
    return noChange('not-handled');
  }
  if (outcome.status === 'FAILED') return { kind: 'fail' };
  if (outcome.status === 'SUCCEEDED') {
    const decision = decideSuccess(payment, attemptId, outcome.amount);
    return decision.kind === 'succeed' ? decision : noChange('still-in-review');
  }
  return noChange('still-in-review');
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
