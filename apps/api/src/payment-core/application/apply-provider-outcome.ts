import type { Payment } from '../domain/payment.js';
import type {
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../domain/payment-transaction.js';
import {
  decideOutcome,
  type OutcomeDecision,
} from '../domain/rules/apply-outcome.js';
import { isOpenAttempt } from '../domain/rules/attempt-transitions.js';
import { canTransitionPayment } from '../domain/rules/payment-transitions.js';
import type { ReviewReason } from '../domain/statuses.js';
import type { Repositories } from '../infrastructure/prisma/repositories.js';
import type { NormalizedOutcome } from '../port/index.js';
import {
  recordAttemptTransition,
  type TransitionCause,
} from './record-attempt-transition.js';

export interface ProviderOutcomeInput {
  /** The Payment as loaded by `findForUpdate`: the caller holds its lock. */
  readonly payment: Payment;
  /** The attempt the provider reported on (its Attempt Key). */
  readonly attemptId: string;
  /** What the provider reported (callback or status query). */
  readonly outcome: NormalizedOutcome & { readonly providerRef?: string };
  /** Trigger and actor for the status transitions, e.g. `webhook` / `system`. */
  readonly cause: TransitionCause;
  /** The injected Clock's time, recorded as the review opened time. */
  readonly now: Date;
}

export interface AppliedProviderOutcome {
  readonly decision: OutcomeDecision;
  /** The Payment after the change, with its attempts. */
  readonly payment: Payment;
  /** The reported attempt after the change. */
  readonly attempt: PaymentTransaction;
  /** True when the Payment status changed. */
  readonly paymentChanged: boolean;
  /**
   * Other open attempts cancelled locally because the Payment succeeded.
   * After commit, the caller asks their providers to cancel, best-effort.
   */
  readonly cancelledAttempts: readonly PaymentTransaction[];
}

/**
 * Applies a provider-reported outcome to one attempt and its Payment, inside
 * the caller's transaction and under its Payment lock. Shared by every path
 * that learns a provider result: webhook processing (ticket 19), status
 * queries (20), late success (21), the expiry worker (24) and review
 * re-queries (28). The rule itself is `decideOutcome`; this carries it out:
 *
 * - succeed: attempt `SUCCEEDED`, Payment `SUCCEEDED` with its transition and
 *   `PaymentSucceeded`, other open attempts `CANCELLED` (provider cancel is
 *   the caller's job after commit).
 * - fail: attempt `FAILED`; the Payment is unchanged.
 * - review: attempt `REQUIRES_REVIEW` with reason, review opened time and
 *   `refund_required`; `PaymentRequiresReview` is written (the attempt enters
 *   review here for the first time, repeats are no-ops).
 * - no-change: nothing moves.
 *
 * A provider reference the attempt does not have yet is stored in every case
 * (it is set once and never changes, invariant 5).
 */
export async function applyProviderOutcome(
  repos: Repositories,
  input: ProviderOutcomeInput,
): Promise<AppliedProviderOutcome> {
  const { payment, attemptId, outcome, cause } = input;
  const attempt = payment.attempts.find((a) => a.id === attemptId);
  if (!attempt) {
    throw new Error(`Attempt ${attemptId} is not an attempt of ${payment.id}`);
  }
  const decision = decideOutcome({ payment, attemptId }, outcome);
  const providerData: Omit<PaymentTransactionChanges, 'status'> =
    outcome.providerRef !== undefined && attempt.providerRef === null
      ? { providerRef: outcome.providerRef }
      : {};
  const reason = cause.reason ?? outcome.rawCode ?? null;
  // A review closed by a clear answer no longer owes the customer a refund
  // (ticket 28); the review reason stays as history.
  const leavingReview = attempt.status === 'REQUIRES_REVIEW';
  const resolvedData: Omit<PaymentTransactionChanges, 'status'> = {
    ...providerData,
    ...(leavingReview ? { refundRequired: false } : {}),
  };

  let updated = attempt;
  let paymentChanged = false;
  let cancelledAttempts: PaymentTransaction[] = [];

  switch (decision.kind) {
    case 'succeed':
      updated = await recordAttemptTransition(
        repos,
        attempt,
        'SUCCEEDED',
        { ...cause, reason },
        resolvedData,
      );
      await succeedPayment(repos, payment, updated, cause);
      paymentChanged = true;
      cancelledAttempts = await cancelOtherOpenAttempts(
        repos,
        payment,
        attemptId,
        cause,
      );
      break;
    case 'fail':
      updated = await recordAttemptTransition(
        repos,
        attempt,
        'FAILED',
        { ...cause, reason },
        resolvedData,
      );
      break;
    case 'review':
      updated = await openReview(repos, payment, attempt, decision.reason, {
        cause,
        now: input.now,
        providerData,
      });
      break;
    case 'no-change':
      if (Object.keys(providerData).length > 0) {
        updated = await repos.payments.updateAttempt(attempt.id, providerData);
      }
      break;
  }

  const after = await repos.payments.findById(payment.id);
  if (!after) throw new Error(`Payment ${payment.id} vanished`);
  return {
    decision,
    payment: after,
    attempt: updated,
    paymentChanged,
    cancelledAttempts,
  };
}

export async function succeedPayment(
  repos: Repositories,
  payment: Payment,
  attempt: PaymentTransaction,
  cause: TransitionCause,
): Promise<void> {
  if (!canTransitionPayment(payment.status, 'SUCCEEDED')) {
    throw new Error(
      `Payment ${payment.id} cannot succeed from ${payment.status}`,
    );
  }
  const succeeded = await repos.payments.update(payment.id, {
    status: 'SUCCEEDED',
  });
  await repos.statusTransitions.record({
    entityType: 'PAYMENT',
    entityId: payment.id,
    fromStatus: payment.status,
    toStatus: succeeded.status,
    trigger: cause.trigger,
    actor: cause.actor,
    reason: `attempt ${attempt.id} succeeded`,
  });
  await repos.outbox.add({
    eventType: 'PaymentSucceeded',
    paymentId: payment.id,
    payload: {
      paymentId: payment.id,
      upstreamReference: succeeded.merchantOrderId,
      amount: succeeded.amount,
      currency: succeeded.currency,
      status: succeeded.status,
      attemptId: attempt.id,
      gatewayId: attempt.gatewayId,
    },
  });
}

export async function cancelOtherOpenAttempts(
  repos: Repositories,
  payment: Payment,
  succeededId: string,
  cause: TransitionCause,
): Promise<PaymentTransaction[]> {
  const cancelled: PaymentTransaction[] = [];
  for (const other of payment.attempts) {
    if (other.id === succeededId || !isOpenAttempt(other.status)) continue;
    cancelled.push(
      await recordAttemptTransition(repos, other, 'CANCELLED', {
        trigger: cause.trigger,
        actor: cause.actor,
        reason: `payment succeeded through attempt ${succeededId}`,
      }),
    );
  }
  return cancelled;
}

async function openReview(
  repos: Repositories,
  payment: Payment,
  attempt: PaymentTransaction,
  reviewReason: ReviewReason,
  options: {
    cause: TransitionCause;
    now: Date;
    providerData: Omit<PaymentTransactionChanges, 'status'>;
  },
): Promise<PaymentTransaction> {
  const inReview = await recordAttemptTransition(
    repos,
    attempt,
    'REQUIRES_REVIEW',
    { ...options.cause, reason: reviewReason },
    {
      ...options.providerData,
      reviewReason,
      reviewOpenedAt: options.now,
      // Money may have been collected and the attempt is not SUCCEEDED.
      refundRequired: true,
    },
  );
  await repos.outbox.add({
    eventType: 'PaymentRequiresReview',
    paymentId: payment.id,
    payload: {
      paymentId: payment.id,
      upstreamReference: payment.merchantOrderId,
      status: payment.status,
      attemptId: inReview.id,
      gatewayId: inReview.gatewayId,
      reviewReason,
      refundRequired: true,
      reviewOpenedAt: options.now.toISOString(),
    },
  });
  return inReview;
}
