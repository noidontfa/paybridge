import { InvalidAttemptTransitionError } from '../domain/errors.js';
import type {
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../domain/payment-transaction.js';
import { canTransitionAttempt } from '../domain/rules/attempt-transitions.js';
import type { AttemptStatus } from '../domain/statuses.js';
import { organizationScope } from '../domain/organization-scope.js';
import type { Repositories } from '../domain/repositories.js';

/** What caused an attempt transition, written to the status-transition trail. */
export interface TransitionCause {
  /** e.g. `start_attempt`, `gateway_rejected`, `webhook`, `status_query`. */
  readonly trigger: string;
  /** e.g. `customer`, `system`, an operator id. */
  readonly actor: string;
  /** The Role the acting User held, when the actor is a User. */
  readonly actorRole?: string;
  /** The acting User's name, when the actor is a User. */
  readonly actorName?: string;
  readonly reason?: string | null;
}

/**
 * Moves an attempt to `to` and writes its status transition, with the
 * transaction-bound repositories of the caller (who holds the Payment lock).
 * Every use case and worker that changes an attempt's status goes through
 * this, so the state table and the audit trail are applied in one place.
 *
 * - Moving to the status the attempt already has does nothing (spec:
 *   transitions are idempotent) and returns the attempt unchanged.
 * - A move the state table forbids throws `InvalidAttemptTransitionError`.
 * - `changes` (provider reference, next action, ...) are written with the
 *   status. They must not carry `status`.
 */
export async function recordAttemptTransition(
  repos: Repositories,
  attempt: PaymentTransaction,
  to: AttemptStatus,
  cause: TransitionCause,
  changes: Omit<PaymentTransactionChanges, 'status'> = {},
): Promise<PaymentTransaction> {
  if (attempt.status === to) return attempt;
  if (!canTransitionAttempt(attempt.status, to)) {
    throw new InvalidAttemptTransitionError(attempt.id, attempt.status, to);
  }
  const scope = organizationScope(attempt.organizationId);
  const updated = await repos.payments.updateAttempt(scope, attempt.id, {
    ...changes,
    status: to,
  });
  await repos.statusTransitions.record(scope, {
    entityType: 'PAYMENT_TRANSACTION',
    entityId: attempt.id,
    fromStatus: attempt.status,
    toStatus: to,
    trigger: cause.trigger,
    actor: cause.actor,
    actorRole: cause.actorRole ?? null,
    actorName: cause.actorName ?? null,
    reason: cause.reason ?? null,
  });
  return updated;
}
