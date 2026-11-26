import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../domain/clock.js';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
  type OrganizationScope,
} from '../../domain/organization-scope.js';
import type { Payment } from '../../domain/payment.js';
import type { PaymentTransaction } from '../../domain/payment-transaction.js';
import { isOpenAttempt } from '../../domain/rules/attempt-transitions.js';
import { canTransitionPayment } from '../../domain/rules/payment-transitions.js';
import { ConnectionPlugins } from '../connection-plugins.js';
import type { QueryResult } from '../../port/index.js';
import { ProviderQueryRateLimiter } from '../provider-query-rate-limiter.js';
import { applyProviderOutcome } from '../apply-provider-outcome.js';
import { BestEffortCancel } from '../best-effort-cancel.js';
import { recordAttemptTransition } from '../record-attempt-transition.js';
import type { Repositories } from '../../domain/repositories.js';
import { TransactionRunner } from '../../domain/transaction-runner.js';

/**
 * What one expiry job did:
 * - `expired`: the Payment is now `EXPIRED` (no open attempt, or every open
 *   attempt was queried and the provider confirmed it unpaid).
 * - `succeeded`: a provider answer showed a payment made before the deadline
 *   and it was applied as a success; the Payment did not expire.
 * - `unclear`: an answer was missing or unclear (provider error, not found,
 *   review state, an attempt that appeared meanwhile). Nothing was closed;
 *   the next sweep queues the Payment again while it stays `PENDING`.
 * - `not-due`, `not-pending`, `not-found`: nothing to do.
 */
export type ExpirePaymentResult =
  'expired' | 'succeeded' | 'unclear' | 'not-due' | 'not-pending' | 'not-found';

type Phase1 =
  | { readonly kind: 'done'; readonly result: ExpirePaymentResult }
  | {
      readonly kind: 'query';
      readonly scope: OrganizationScope;
      readonly attempts: readonly PaymentTransaction[];
    };

interface Answer {
  readonly attempt: PaymentTransaction;
  readonly result: QueryResult;
}

const EXPIRY_CAUSE = { trigger: 'expiry', actor: 'system' } as const;

/**
 * Expiry worker application service (spec: Use cases, `expirePayment`). Runs
 * for one Payment queued by the expiry sweep.
 *
 * 1. Transaction 1 locks the Payment and re-checks it is still `PENDING` with
 *    a passed deadline, so a stale or duplicate job is harmless. It reads the
 *    open attempts and releases the lock. A Payment with no open attempt
 *    expires here and no provider is asked.
 * 2. With no transaction open, each open attempt is queried (rate limited)
 *    and the raw response stored.
 * 3. Transaction 2 locks the Payment again and re-checks it. Every answer goes
 *    through `applyProviderOutcome`, so a payment made just before the
 *    deadline is a success under the rules of tickets 19 and 21. The Payment
 *    expires only if every attempt open at that point was queried and the
 *    provider said it is not paid; those attempts move to `EXPIRED` and
 *    `PaymentExpired` is written.
 * 4. After commit, attempts closed by the job are cancelled best-effort.
 */
@Injectable()
export class ExpirePayment {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ConnectionPlugins) private readonly plugins: ConnectionPlugins,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
    @Inject(ProviderQueryRateLimiter)
    private readonly limiter: ProviderQueryRateLimiter,
  ) {}

  async execute(paymentId: string): Promise<ExpirePaymentResult> {
    const first = await this.runner.run(async (repos): Promise<Phase1> => {
      // The queued job holds only the Payment id, so the first lock looks
      // across Organizations; the rest stays in the Payment's own one.
      const payment = await repos.payments.findForUpdate(
        ALL_ORGANIZATIONS,
        paymentId,
      );
      if (!payment) return { kind: 'done', result: 'not-found' };
      if (payment.status !== 'PENDING') {
        return { kind: 'done', result: 'not-pending' };
      }
      if (payment.expiresAt.getTime() > this.clock.now().getTime()) {
        return { kind: 'done', result: 'not-due' };
      }
      // An attempt in review may hold money: never expire over it.
      if (payment.attempts.some((a) => a.status === 'REQUIRES_REVIEW')) {
        return { kind: 'done', result: 'unclear' };
      }
      const open = payment.attempts.filter((a) => isOpenAttempt(a.status));
      if (open.length === 0) {
        await expirePayment(repos, payment);
        return { kind: 'done', result: 'expired' };
      }
      return {
        kind: 'query',
        scope: organizationScope(payment.organizationId),
        attempts: open,
      };
    });
    if (first.kind === 'done') return first.result;
    return this.expireWithAttempts(first.scope, paymentId, first.attempts);
  }

  private async expireWithAttempts(
    scope: OrganizationScope,
    paymentId: string,
    open: readonly PaymentTransaction[],
  ): Promise<ExpirePaymentResult> {
    const answers = await this.queryAll(open);
    const { result, toCancel } = await this.runner.run((repos) =>
      this.close(repos, scope, paymentId, answers),
    );
    if (toCancel.length > 0) await this.cancels.cancel(toCancel);
    return result;
  }

  /** Queries each attempt with no transaction open; a failed query is skipped. */
  private async queryAll(
    open: readonly PaymentTransaction[],
  ): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (const attempt of open) {
      try {
        await this.limiter.acquire();
        const result = await (
          await this.plugins.forExisting(
            attempt.organizationId,
            attempt.gatewayId,
          )
        ).query({
          attemptKey: attempt.id,
          providerMetadata: attempt.providerMetadata ?? {},
        });
        await this.runner.repositories.gatewayRawResponses.record(
          organizationScope(attempt.organizationId),
          {
            attemptId: attempt.id,
            operation: 'query',
            payload: result.rawPayload,
          },
        );
        answers.push({ attempt, result });
      } catch {
        // Unavailable, unknown outcome or not found: not a confirmation of
        // "unpaid". The Payment stays PENDING for the next sweep.
      }
    }
    return answers;
  }

  private async close(
    repos: Repositories,
    scope: OrganizationScope,
    paymentId: string,
    answers: readonly Answer[],
  ): Promise<{
    result: ExpirePaymentResult;
    toCancel: readonly PaymentTransaction[];
  }> {
    let payment = await repos.payments.findForUpdate(scope, paymentId);
    if (!payment) return { result: 'not-found', toCancel: [] };

    const toCancel: PaymentTransaction[] = [];
    let succeeded = false;
    // Apply every answer under the current state: a success is never dropped,
    // and a result on an attempt that changed follows the rules for it.
    for (const { attempt, result } of answers) {
      const applied = await applyProviderOutcome(repos, {
        payment,
        attemptId: attempt.id,
        outcome: result,
        cause: { ...EXPIRY_CAUSE },
        now: this.clock.now(),
      });
      payment = applied.payment;
      toCancel.push(...applied.cancelledAttempts);
      if (applied.decision.kind === 'succeed') succeeded = true;
    }
    if (succeeded) return { result: 'succeeded', toCancel };

    // Re-check after the queries; nothing is overwritten.
    if (payment.status !== 'PENDING')
      return { result: 'not-pending', toCancel };
    if (payment.expiresAt.getTime() > this.clock.now().getTime()) {
      return { result: 'not-due', toCancel };
    }
    if (payment.attempts.some((a) => a.status === 'REQUIRES_REVIEW')) {
      return { result: 'unclear', toCancel };
    }
    // Every attempt still open must have been queried and found unpaid
    // (`PENDING`; a `FAILED` answer already closed its attempt above).
    const unpaid = new Set(
      answers
        .filter((a) => a.result.status === 'PENDING')
        .map((a) => a.attempt.id),
    );
    const stillOpen = payment.attempts.filter((a) => isOpenAttempt(a.status));
    if (!stillOpen.every((a) => unpaid.has(a.id))) {
      return { result: 'unclear', toCancel };
    }

    for (const attempt of stillOpen) {
      // The state table has no CREATED -> EXPIRED edge: an attempt the gateway
      // never accepted is closed by its CREATED -> CANCELLED edge instead, so
      // the Payment can still expire.
      const to = attempt.status === 'CREATED' ? 'CANCELLED' : 'EXPIRED';
      const closed = await recordAttemptTransition(repos, attempt, to, {
        ...EXPIRY_CAUSE,
        reason:
          to === 'CANCELLED'
            ? 'deadline passed before the gateway accepted the attempt'
            : 'provider confirmed unpaid at deadline',
      });
      toCancel.push(closed);
    }
    await expirePayment(repos, payment);
    return { result: 'expired', toCancel };
  }
}

async function expirePayment(
  repos: Repositories,
  payment: Payment,
): Promise<void> {
  if (!canTransitionPayment(payment.status, 'EXPIRED')) {
    throw new Error(
      `Payment ${payment.id} cannot expire from ${payment.status}`,
    );
  }
  const scope = organizationScope(payment.organizationId);
  const expired = await repos.payments.update(scope, payment.id, {
    status: 'EXPIRED',
  });
  await repos.statusTransitions.record(scope, {
    entityType: 'PAYMENT',
    entityId: payment.id,
    fromStatus: payment.status,
    toStatus: expired.status,
    trigger: 'expiry',
    actor: 'system',
  });
  await repos.outbox.add(scope, {
    eventType: 'PaymentExpired',
    paymentId: payment.id,
    payload: {
      paymentId: payment.id,
      upstreamReference: expired.merchantOrderId,
      amount: expired.amount,
      currency: expired.currency,
      status: expired.status,
      expiresAt: expired.expiresAt.toISOString(),
    },
  });
}
