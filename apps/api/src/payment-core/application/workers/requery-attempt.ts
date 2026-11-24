import { Inject, Injectable, Logger } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { Clock } from '../../domain/clock.js';
import { isOpenAttempt } from '../../domain/rules/attempt-transitions.js';
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
    const repos = this.runner.repositories;
    const paymentId = isUuid(attemptId)
      ? await repos.payments.findPaymentIdByAttemptId(attemptId)
      : null;
    const payment = paymentId ? await repos.payments.findById(paymentId) : null;
    const attempt = payment?.attempts.find((a) => a.id === attemptId);
    if (!payment || !attempt || !isOpenAttempt(attempt.status)) {
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
    await repos.gatewayRawResponses.record({
      attemptId: attempt.id,
      operation: 'query',
      payload: result.rawPayload,
    });

    const applied = await this.apply(payment.id, attempt.id, result);
    if (applied.cancelledAttempts.length > 0) {
      await this.cancels.cancel(applied.cancelledAttempts);
    }
    return 'applied';
  }

  private apply(
    paymentId: string,
    attemptId: string,
    outcome: QueryResult,
  ): Promise<AppliedProviderOutcome> {
    return this.runner.run(async (repos) => {
      const locked = await repos.payments.findForUpdate(paymentId);
      if (!locked) throw new Error(`Payment ${paymentId} vanished`);
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
