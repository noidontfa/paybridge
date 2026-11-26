import { Inject, Injectable } from '@nestjs/common';
import {
  AttemptNotFoundError,
  PaymentNotFoundError,
} from '../../domain/errors.js';
import { Clock } from '../../domain/services/clock.js';
import type { OrganizationScope } from '../../domain/value-objects/organization-scope.js';
import type { Payment } from '../../domain/entities/payment.js';
import {
  decideReviewResolution,
  type OperatorResolutionStatus,
} from '../../domain/rules/review-resolution.js';
import { ConnectionPlugins } from '../connection-plugins.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import {
  cancelOtherOpenAttempts,
  succeedPayment,
} from '../apply-provider-outcome.js';
import {
  BestEffortCancel,
  type CancellableAttempt,
} from '../best-effort-cancel.js';
import { recordAttemptTransition } from '../record-attempt-transition.js';

export interface ResolveReviewInput {
  readonly paymentId: string;
  readonly attemptId: string;
  /** The id of the User who decided, from their access token. */
  readonly actor: string;
  /** The Role that User held. */
  readonly actorRole: string;
  /** That User's name. */
  readonly actorName: string;
  readonly note: string;
  /** Absent: add a note without changing the status. */
  readonly status?: OperatorResolutionStatus;
  /** The amount the operator confirmed with the provider (for `SUCCEEDED`). */
  readonly amount?: string;
}

/**
 * Operator review resolution (spec: Use cases, `resolveReview`). One
 * transaction locks the Payment, applies the rules in
 * `decideReviewResolution`, changes the attempt (and the Payment on
 * `SUCCEEDED`) through the shared transition writers with the operator as
 * actor and the note as reason, and writes `PaymentSucceeded` when the
 * Payment status changed. A note-only request records an audit row from
 * `REQUIRES_REVIEW` to `REQUIRES_REVIEW` and changes nothing else.
 * Other open attempts cancelled by a promotion are cancelled at their
 * providers after commit, best-effort.
 */
@Injectable()
export class ResolveReview {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ConnectionPlugins) private readonly plugins: ConnectionPlugins,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
  ) {}

  async execute(
    scope: OrganizationScope,
    input: ResolveReviewInput,
  ): Promise<Payment> {
    const { payment, cancelled } = await this.runner.run(async (repos) => {
      const locked = await repos.payments.findForUpdate(scope, input.paymentId);
      if (!locked) throw new PaymentNotFoundError(input.paymentId);
      const attempt = locked.attempts.find((a) => a.id === input.attemptId);
      if (!attempt) {
        throw new AttemptNotFoundError(locked.id, input.attemptId);
      }

      const decision = decideReviewResolution({
        payment: locked,
        attempt,
        status: input.status,
        amount: input.amount,
        now: this.clock.now(),
      });
      const cause = {
        trigger: 'operator_resolution',
        actor: input.actor,
        actorRole: input.actorRole,
        actorName: input.actorName,
        reason: input.note,
      };
      let cancelled: CancellableAttempt[] = [];

      switch (decision.kind) {
        case 'note':
          await repos.statusTransitions.record(scope, {
            entityType: 'PAYMENT_TRANSACTION',
            entityId: attempt.id,
            fromStatus: attempt.status,
            toStatus: attempt.status,
            trigger: 'operator_note',
            actor: input.actor,
            actorRole: input.actorRole,
            actorName: input.actorName,
            reason: input.note,
          });
          break;
        case 'fail':
          // Money was not collected: the review no longer owes a refund.
          await recordAttemptTransition(repos, attempt, 'FAILED', cause, {
            refundRequired: false,
          });
          break;
        case 'succeed': {
          const succeeded = await recordAttemptTransition(
            repos,
            attempt,
            'SUCCEEDED',
            cause,
            { refundRequired: false },
          );
          await succeedPayment(repos, locked, succeeded, cause);
          cancelled = await cancelOtherOpenAttempts(
            repos,
            locked,
            attempt.id,
            cause,
          );
          break;
        }
      }

      const reloaded = await repos.payments.findById(scope, locked.id);
      return { payment: reloaded ?? locked, cancelled };
    });

    // After commit; never throws. Only plugins that declare supportsCancel.
    const cancellable: CancellableAttempt[] = [];
    for (const a of cancelled) if (await this.canCancel(a)) cancellable.push(a);
    await this.cancels.cancel(cancellable);
    return payment;
  }

  private async canCancel(attempt: CancellableAttempt): Promise<boolean> {
    try {
      return (
        await this.plugins.forExisting(
          attempt.organizationId,
          attempt.gatewayId,
        )
      ).capabilities.supportsCancel;
    } catch {
      return false;
    }
  }
}
