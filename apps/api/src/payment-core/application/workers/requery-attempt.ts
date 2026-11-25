import { Inject, Injectable, Logger } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { Clock } from '../../domain/clock.js';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
  type OrganizationScope,
} from '../../domain/organization-scope.js';
import type { Payment } from '../../domain/payment.js';
import type { PaymentTransaction } from '../../domain/payment-transaction.js';
import { isOpenAttempt } from '../../domain/rules/attempt-transitions.js';
import { isReviewRequeryEligible } from '../../domain/rules/review-requery.js';
import { GatewayManager } from '../../gateway-manager/gateway-manager.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import {
  GatewayNotFoundError,
  isGatewayError,
  type GatewayError,
  type QueryResult,
} from '../../port/index.js';
import {
  applyProviderOutcome,
  type AppliedProviderOutcome,
} from '../apply-provider-outcome.js';
import { BestEffortCancel } from '../best-effort-cancel.js';

/**
 * - `applied`: the provider answered and the outcome went through the shared
 *   rules (a pending answer or a repeat changes nothing).
 * - `skipped`: the attempt is unknown or no longer open; nothing to ask.
 * - `not-found`: the provider has no such transaction; the attempt is left
 *   as it is (expiry decides what that means, ticket 24).
 */
export type RequeryAttemptResult =
  'applied' | 'skipped' | 'not-found' | 'unchanged';

/**
 * A query only reads, so it is safe to repeat: a retryable error is retried,
 * and so is `OutcomeUnknown` (its `retryable` flag only forbids re-sending a
 * write). Any other gateway error ends the job with the attempt unchanged.
 */
function retriesQuery(error: GatewayError): boolean {
  return error.retryable || error.category === 'OutcomeUnknown';
}

/**
 * Status query worker service (spec: Use cases, `requeryAttempt`), run for
 * one attempt after a browser return:
 *
 * 1. Read the attempt with no lock; stop if it is not open.
 * 2. Ask the plugin (`query`) with no transaction open, and store the raw
 *    response.
 * 3. One transaction: lock the Payment and apply the answer with
 *    `applyProviderOutcome`, the same rules as webhooks.
 * 4. After commit, best-effort cancel of attempts cancelled in step 3.
 *
 * Error categories (ticket 22): `GatewayUnavailable` and `OutcomeUnknown`
 * propagate so the queue retries the job; `NotFound` and other non-retryable
 * errors are logged. A failed query never changes the attempt.
 */
@Injectable()
export class RequeryAttempt {
  private readonly logger = new Logger(RequeryAttempt.name);

  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async execute(attemptId: string): Promise<RequeryAttemptResult> {
    return this.requery(attemptId, (attempt) => isOpenAttempt(attempt.status));
  }

  /**
   * Re-query of an attempt in an automatic review (ticket 28): the same
   * query and `applyProviderOutcome` path, for an attempt in
   * `REQUIRES_REVIEW` whose reason is re-queried and whose review opened less
   * than 72 hours ago. Eligibility is checked again under the Payment lock,
   * so an attempt an operator or a webhook resolved meanwhile is left alone.
   * A clear success promotes, a clear failure fails the attempt, anything
   * else leaves it in review for the next run.
   */
  async executeReview(attemptId: string): Promise<RequeryAttemptResult> {
    const eligible = (attempt: PaymentTransaction): boolean =>
      isReviewRequeryEligible(attempt, this.clock.now());
    return this.requery(attemptId, eligible, eligible);
  }

  private async requery(
    attemptId: string,
    eligible: (attempt: PaymentTransaction) => boolean,
    recheckUnderLock?: (attempt: PaymentTransaction) => boolean,
  ): Promise<RequeryAttemptResult> {
    const repos = this.runner.repositories;
    // The queued job holds only the attempt id, so the first reads look
    // across Organizations; the rest stays in the Payment's own one.
    const paymentId = isUuid(attemptId)
      ? await repos.payments.findPaymentIdByAttemptId(
          ALL_ORGANIZATIONS,
          attemptId,
        )
      : null;
    const payment = paymentId
      ? await repos.payments.findById(ALL_ORGANIZATIONS, paymentId)
      : null;
    const attempt = payment?.attempts.find((a) => a.id === attemptId);
    if (!payment || !attempt || !eligible(attempt)) {
      return 'skipped';
    }

    let result: QueryResult;
    try {
      result = await this.gateways.resolve(attempt.gatewayId).query({
        attemptKey: attempt.id,
        providerMetadata: attempt.providerMetadata ?? {},
      });
    } catch (error) {
      if (error instanceof GatewayNotFoundError) {
        this.logger.warn(
          `Provider has no transaction for attempt ${attempt.id}`,
        );
        return 'not-found';
      }
      if (isGatewayError(error) && !retriesQuery(error)) {
        // E.g. a rejection of a read: nothing to retry, attempt unchanged.
        this.logger.error(
          `Status query of attempt ${attempt.id} failed for good (${error.category}): ${error.message}`,
        );
        return 'unchanged';
      }
      // GatewayUnavailable and OutcomeUnknown (and unexpected errors): the
      // attempt is untouched and the queue retries the job.
      throw error;
    }
    const scope = organizationScope(payment.organizationId);
    await repos.gatewayRawResponses.record(scope, {
      attemptId: attempt.id,
      operation: 'query',
      payload: result.rawPayload,
    });

    const applied = await this.apply(
      scope,
      payment.id,
      attempt.id,
      result,
      recheckUnderLock,
    );
    if (!applied) return 'skipped';
    if (applied.cancelledAttempts.length > 0) {
      await this.cancels.cancel(applied.cancelledAttempts);
    }
    return 'applied';
  }

  private apply(
    scope: OrganizationScope,
    paymentId: string,
    attemptId: string,
    outcome: QueryResult,
    recheck?: (attempt: PaymentTransaction) => boolean,
  ): Promise<AppliedProviderOutcome | null> {
    return this.runner.run(async (repos) => {
      const locked: Payment | null = await repos.payments.findForUpdate(
        scope,
        paymentId,
      );
      if (!locked) throw new Error(`Payment ${paymentId} vanished`);
      // The state may have moved since the unlocked read: review re-queries
      // check again. Other queries do not: a late success must never be
      // dropped (ticket 21).
      if (recheck) {
        const current = locked.attempts.find((a) => a.id === attemptId);
        if (!current || !recheck(current)) return null;
      }
      return applyProviderOutcome(repos, {
        payment: locked,
        attemptId,
        outcome,
        cause: { trigger: 'status_query', actor: 'system' },
        now: this.clock.now(),
      });
    });
  }
}
