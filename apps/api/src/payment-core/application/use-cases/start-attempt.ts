import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../domain/clock.js';
import {
  AttemptInReviewError,
  PaymentExpiryPassedError,
  PaymentNotFoundError,
  PaymentNotPendingError,
  UnknownGatewayIdError,
  UnsupportedCurrencyError,
} from '../../domain/errors.js';
import { newId } from '../../domain/ids.js';
import type { Payment } from '../../domain/payment.js';
import type {
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../../domain/payment-transaction.js';
import {
  INITIAL_ATTEMPT_STATUS,
  isOpenAttempt,
} from '../../domain/rules/attempt-transitions.js';
import {
  GatewayManager,
  UnknownGatewayError,
} from '../../gateway-manager/gateway-manager.js';
import type { Repositories } from '../../infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import {
  GatewayRejectedError,
  type GatewayCurrency,
  type InitiateResult,
  type PaymentGateway,
} from '../../port/index.js';
import {
  BestEffortCancel,
  type CancellableAttempt,
} from '../best-effort-cancel.js';
import { recordAttemptTransition } from '../record-attempt-transition.js';

export interface StartAttemptInput {
  readonly paymentId: string;
  /** Gateway identifier of a registered Gateway Plugin, e.g. `vnpay`. */
  readonly gatewayId: string;
  /** Where the provider sends the customer's browser back to. */
  readonly returnUrl: string;
  /** Shown by the provider. Default: `Payment <upstream reference>`. */
  readonly description?: string;
}

export interface StartAttemptResult {
  /** The Payment after the attempt was recorded, with its attempts. */
  readonly payment: Payment;
  /** The new attempt: `PENDING` with a next action, or `FAILED`. */
  readonly attempt: PaymentTransaction;
}

/** What `initiate` produced, as far as this use case decides on it. */
type InitiateOutcome =
  | { readonly kind: 'accepted'; readonly result: InitiateResult }
  | { readonly kind: 'rejected'; readonly error: GatewayRejectedError };

const CUSTOMER = 'customer';
const SYSTEM = 'system';

/**
 * Starts an attempt on a Payment through the chosen gateway (spec: Use cases,
 * `startAttempt`). Three steps, never holding a transaction across the
 * gateway call:
 *
 * 1. `openAttempt`: lock the Payment, check it accepts an attempt, insert the
 *    attempt as `CREATED` with its attempt key.
 * 2. `initiate`: call the Gateway Plugin with no transaction open.
 * 3. `recordOutcome`: lock the Payment again, re-check it, and record
 *    `PENDING` (provider reference, next action, metadata, raw response) or
 *    `FAILED` on a synchronous rejection.
 *
 * Gateway switch (ticket 16): step 1 also cancels the open attempt, if any,
 * in the same transaction, so at most one attempt is open. After that commit
 * the old provider is asked to cancel, best-effort, alongside step 2. The
 * other gateway error categories (ticket 22) extend step 2.
 */
@Injectable()
export class StartAttempt {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
  ) {}

  async execute(input: StartAttemptInput): Promise<StartAttemptResult> {
    const plugin = this.resolveGateway(input.gatewayId);
    const { payment, attempt, switchedFrom } = await this.openAttempt(input);
    // After commit; never throws, so it cannot undo the local cancel.
    const providerCancel = this.cancels.cancel(switchedFrom);
    try {
      const outcome = await this.initiate(plugin, payment, attempt, input);
      return await this.recordOutcome(payment.id, attempt.id, outcome);
    } finally {
      await providerCancel;
    }
  }

  private resolveGateway(gatewayId: string): PaymentGateway {
    try {
      return this.gateways.resolve(gatewayId);
    } catch (error) {
      if (error instanceof UnknownGatewayError) {
        throw new UnknownGatewayIdError(gatewayId);
      }
      throw error;
    }
  }

  /** Step 1: one short transaction under the Payment lock. */
  private openAttempt(input: StartAttemptInput): Promise<{
    payment: Payment;
    attempt: PaymentTransaction;
    /** Open attempts cancelled by this gateway switch (at most one). */
    switchedFrom: CancellableAttempt[];
  }> {
    return this.runner.run(async (repos) => {
      const payment = await repos.payments.findForUpdate(input.paymentId);
      if (!payment) throw new PaymentNotFoundError(input.paymentId);
      this.assertAcceptsAttempt(payment);

      const switchedFrom: CancellableAttempt[] = [];
      for (const open of payment.attempts.filter((a) =>
        isOpenAttempt(a.status),
      )) {
        switchedFrom.push(
          await recordAttemptTransition(repos, open, 'CANCELLED', {
            trigger: 'gateway_switch',
            actor: CUSTOMER,
          }),
        );
      }

      const attempt = await repos.payments.createAttempt({
        id: newId(),
        paymentId: payment.id,
        gatewayId: input.gatewayId,
        status: INITIAL_ATTEMPT_STATUS,
      });
      await repos.statusTransitions.record({
        entityType: 'PAYMENT_TRANSACTION',
        entityId: attempt.id,
        fromStatus: null,
        toStatus: attempt.status,
        trigger: 'start_attempt',
        actor: CUSTOMER,
      });
      return { payment, attempt, switchedFrom };
    });
  }

  private assertAcceptsAttempt(payment: Payment): void {
    if (payment.status !== 'PENDING') {
      throw new PaymentNotPendingError(payment.id, payment.status);
    }
    if (payment.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new PaymentExpiryPassedError(payment.id);
    }
    const inReview = payment.attempts.find(
      (a) => a.status === 'REQUIRES_REVIEW',
    );
    if (inReview) throw new AttemptInReviewError(payment.id, inReview.id);
    // An open attempt does not block: openAttempt cancels it (gateway switch).
  }

  /** Step 2: the gateway call, with no transaction open. */
  private async initiate(
    plugin: PaymentGateway,
    payment: Payment,
    attempt: PaymentTransaction,
    input: StartAttemptInput,
  ): Promise<InitiateOutcome> {
    try {
      const result = await plugin.initiate({
        attemptKey: attempt.id,
        amount: payment.amount,
        currency: gatewayCurrency(payment.currency),
        expiresAt: payment.expiresAt,
        returnUrl: input.returnUrl,
        description: input.description ?? `Payment ${payment.merchantOrderId}`,
      });
      return { kind: 'accepted', result };
    } catch (error) {
      if (error instanceof GatewayRejectedError) {
        return { kind: 'rejected', error };
      }
      // GatewayUnavailable and OutcomeUnknown: ticket 22. The attempt stays
      // CREATED.
      throw error;
    }
  }

  /** Step 3: one short transaction that re-checks state before writing. */
  private recordOutcome(
    paymentId: string,
    attemptId: string,
    outcome: InitiateOutcome,
  ): Promise<StartAttemptResult> {
    return this.runner.run(async (repos) => {
      const payment = await repos.payments.findForUpdate(paymentId);
      if (!payment) throw new PaymentNotFoundError(paymentId);
      const attempt = payment.attempts.find((a) => a.id === attemptId);
      if (!attempt) {
        throw new Error(`Attempt ${attemptId} vanished from ${paymentId}`);
      }

      // Only a still-PENDING Payment whose attempt is still CREATED takes the
      // initiate result as a status change. Otherwise something moved while
      // the gateway was called (a cancel, the expiry, an early webhook): the
      // Payment and the attempt status stay as they are, and a later provider
      // result is handled by the late-success rules (ticket 21).
      const current =
        payment.status === 'PENDING' && attempt.status === 'CREATED';

      if (outcome.kind === 'accepted') {
        await recordAccepted(repos, attempt, outcome.result, current);
      } else if (current) {
        await recordAttemptTransition(repos, attempt, 'FAILED', {
          trigger: 'gateway_rejected',
          actor: SYSTEM,
          reason: outcome.error.message,
        });
      }

      const after = await repos.payments.findById(paymentId);
      if (!after) throw new PaymentNotFoundError(paymentId);
      const recorded = after.attempts.find((a) => a.id === attemptId);
      if (!recorded) {
        throw new Error(`Attempt ${attemptId} vanished from ${paymentId}`);
      }
      return { payment: after, attempt: recorded };
    });
  }
}

/**
 * Stores what the gateway returned for an accepted initiate. The raw response
 * and the provider data are always kept, because later queries and cancels
 * need them; the status moves to `PENDING` only when `current`.
 */
async function recordAccepted(
  repos: Repositories,
  attempt: PaymentTransaction,
  result: InitiateResult,
  current: boolean,
): Promise<void> {
  await repos.gatewayRawResponses.record({
    attemptId: attempt.id,
    operation: 'initiate',
    payload: result.rawPayload,
  });
  const providerData: Omit<PaymentTransactionChanges, 'status'> = {
    providerMetadata: result.providerMetadata,
    // The provider reference is set once and never changes (invariant 5).
    ...(result.providerRef !== undefined &&
      attempt.providerRef === null && { providerRef: result.providerRef }),
  };
  if (current) {
    await recordAttemptTransition(
      repos,
      attempt,
      'PENDING',
      { trigger: 'gateway_accepted', actor: SYSTEM },
      { ...providerData, nextAction: result.nextAction },
    );
  } else {
    await repos.payments.updateAttempt(attempt.id, providerData);
  }
}

function gatewayCurrency(currency: string): GatewayCurrency {
  if (currency !== 'VND') throw new UnsupportedCurrencyError(currency);
  return currency;
}
