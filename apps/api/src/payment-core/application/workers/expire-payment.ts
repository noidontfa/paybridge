import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../domain/clock.js';
import type { Payment } from '../../domain/payment.js';
import { canTransitionPayment } from '../../domain/rules/payment-transitions.js';
import type { Repositories } from '../../infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';

/**
 * What one expiry job did:
 * - `expired`: the Payment had no attempt and is now `EXPIRED`.
 * - `has-attempts`: the Payment has attempts; closing it needs provider
 *   queries first, which is the attempt expiry's job (ticket 24). Nothing
 *   changed; the next sweep queues it again while it stays `PENDING`.
 * - `not-due`, `not-pending`, `not-found`: nothing to do.
 */
export type ExpirePaymentResult =
  'expired' | 'has-attempts' | 'not-due' | 'not-pending' | 'not-found';

/**
 * Expiry worker application service (spec: Use cases, `expirePayment`). Runs
 * for one Payment queued by the expiry sweep. Locks the Payment and re-checks
 * it is still `PENDING` with a passed deadline, so a stale or duplicate job is
 * harmless.
 *
 * A Payment with no attempt expires here, in one transaction with its status
 * transition and `PaymentExpired` event, and no provider is asked.
 */
@Injectable()
export class ExpirePayment {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async execute(paymentId: string): Promise<ExpirePaymentResult> {
    const outcome = await this.runner.run(async (repos) => {
      const payment = await repos.payments.findForUpdate(paymentId);
      if (!payment) return 'not-found';
      if (payment.status !== 'PENDING') return 'not-pending';
      if (payment.expiresAt.getTime() > this.clock.now().getTime()) {
        return 'not-due';
      }
      if (payment.attempts.length > 0) return 'has-attempts';
      await expireWithoutAttempts(repos, payment);
      return 'expired';
    });
    if (outcome === 'has-attempts') return this.expireWithAttempts(paymentId);
    return outcome;
  }

  /**
   * Seam for ticket 24: query each open attempt with no transaction open, then
   * lock again, re-check and close. Until then such Payments stay `PENDING`.
   */
  private expireWithAttempts(_paymentId: string): Promise<ExpirePaymentResult> {
    return Promise.resolve('has-attempts');
  }
}

async function expireWithoutAttempts(
  repos: Repositories,
  payment: Payment,
): Promise<void> {
  if (!canTransitionPayment(payment.status, 'EXPIRED')) {
    throw new Error(
      `Payment ${payment.id} cannot expire from ${payment.status}`,
    );
  }
  const expired = await repos.payments.update(payment.id, {
    status: 'EXPIRED',
  });
  await repos.statusTransitions.record({
    entityType: 'PAYMENT',
    entityId: payment.id,
    fromStatus: payment.status,
    toStatus: expired.status,
    trigger: 'expiry',
    actor: 'system',
  });
  await repos.outbox.add({
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
