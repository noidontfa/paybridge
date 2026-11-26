import { Inject, Injectable } from '@nestjs/common';
import {
  PaymentNotFoundError,
  PaymentNotPendingError,
} from '../../domain/errors.js';
import type { OrganizationScope } from '../../domain/organization-scope.js';
import type { Payment } from '../../domain/payment.js';
import { isOpenAttempt } from '../../domain/rules/attempt-transitions.js';
import { canTransitionPayment } from '../../domain/rules/payment-transitions.js';
import { ConnectionPlugins } from '../connection-plugins.js';
import { TransactionRunner } from '../../domain/transaction-runner.js';
import {
  BestEffortCancel,
  type CancellableAttempt,
} from '../best-effort-cancel.js';
import { recordAttemptTransition } from '../record-attempt-transition.js';

const CANCEL_CAUSE = { trigger: 'merchant_cancel', actor: 'merchant' } as const;

/**
 * Merchant cancel (spec: Use cases, `cancelPayment`). One transaction under
 * the Payment lock moves a `PENDING` Payment and all its open attempts to
 * `CANCELLED`, writing the status transitions and the `PaymentCancelled`
 * outbox row. After the commit the providers are asked to cancel,
 * best-effort (`BestEffortCancel`), so a provider failure never changes
 * local state.
 *
 * Cancelling a `CANCELLED` Payment is a no-op that returns it. A `SUCCEEDED`
 * or `EXPIRED` Payment is rejected with `PaymentNotPendingError`.
 */
@Injectable()
export class CancelPayment {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(ConnectionPlugins) private readonly plugins: ConnectionPlugins,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
  ) {}

  async execute(scope: OrganizationScope, paymentId: string): Promise<Payment> {
    const { payment, cancelled } = await this.runner.run(async (repos) => {
      const locked = await repos.payments.findForUpdate(scope, paymentId);
      if (!locked) throw new PaymentNotFoundError(paymentId);
      if (locked.status === 'CANCELLED') {
        return { payment: locked, cancelled: [] };
      }
      if (
        locked.status !== 'PENDING' ||
        !canTransitionPayment(locked.status, 'CANCELLED')
      ) {
        throw new PaymentNotPendingError(locked.id, locked.status);
      }

      const cancelled: CancellableAttempt[] = [];
      for (const open of locked.attempts.filter((a) =>
        isOpenAttempt(a.status),
      )) {
        cancelled.push(
          await recordAttemptTransition(repos, open, 'CANCELLED', CANCEL_CAUSE),
        );
      }

      const updated = await repos.payments.update(scope, locked.id, {
        status: 'CANCELLED',
      });
      await repos.statusTransitions.record(scope, {
        entityType: 'PAYMENT',
        entityId: locked.id,
        fromStatus: locked.status,
        toStatus: updated.status,
        ...CANCEL_CAUSE,
      });
      await repos.outbox.add(scope, {
        eventType: 'PaymentCancelled',
        paymentId: locked.id,
        payload: {
          paymentId: locked.id,
          upstreamReference: updated.merchantOrderId,
          amount: updated.amount,
          currency: updated.currency,
          status: updated.status,
        },
      });
      const reloaded = await repos.payments.findById(scope, locked.id);
      return { payment: reloaded ?? updated, cancelled };
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
