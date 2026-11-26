import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
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
import {
  ALL_ORGANIZATIONS,
  organizationScope,
  type OrganizationScope,
} from '../../domain/organization-scope.js';
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
import { ConnectionPlugins } from '../connection-plugins.js';
import type { Repositories } from '../../infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../../infrastructure/queue/queue.constants.js';
import {
  GatewayRejectedError,
  GatewayUnavailableError,
  OutcomeUnknownError,
  type GatewayCurrency,
  type InitiateResult,
  type PaymentGateway,
} from '../../port/index.js';
import {
  BestEffortCancel,
  type CancellableAttempt,
} from '../best-effort-cancel.js';
import { recordAttemptTransition } from '../record-attempt-transition.js';
import {
  QUERY_ATTEMPT_JOB,
  QUERY_ATTEMPT_JOB_OPTIONS,
  type QueryAttemptJobData,
} from './handle-browser-return.js';

/** BullMQ job name for retrying `initiate` of a `CREATED` attempt. */
export const INITIATE_ATTEMPT_JOB = 'initiate-attempt';

/**
 * What the retry needs that is not stored on the attempt row (the return URL
 * and the description are request data, not Payment data).
 */
export interface InitiateAttemptJobData {
  readonly attemptId: string;
  readonly returnUrl: string;
  readonly description?: string;
}

/**
 * Bounded retry of `initiate` after a `GatewayUnavailable`: 5 tries in all,
 * exponential backoff from 5 s. Removed when finished so nothing piles up;
 * if every try fails the attempt stays `CREATED` and expiry closes it.
 */
export const INITIATE_ATTEMPT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** The status query waits a little: the provider may still be working. */
const UNKNOWN_OUTCOME_QUERY_DELAY_MS = 5_000;

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
  | RecordableOutcome
  | { readonly kind: 'unavailable'; readonly error: GatewayUnavailableError }
  | { readonly kind: 'unknown'; readonly error: OutcomeUnknownError };

/** The outcomes that change the attempt status. */
type RecordableOutcome =
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
  private readonly logger = new Logger(StartAttempt.name);

  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(ConnectionPlugins) private readonly plugins: ConnectionPlugins,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
    @InjectQueue(QUEUES.attemptInitiate) private readonly initiateQueue: Queue,
    @InjectQueue(QUEUES.attemptStatusQuery) private readonly queryQueue: Queue,
  ) {}

  async execute(
    scope: OrganizationScope,
    input: StartAttemptInput,
  ): Promise<StartAttemptResult> {
    const plugin = await this.resolveGateway(scope, input.gatewayId, true);
    const { payment, attempt, switchedFrom } = await this.openAttempt(
      scope,
      input,
    );
    // After commit; never throws, so it cannot undo the local cancel.
    const providerCancel = this.cancels.cancel(switchedFrom);
    try {
      const outcome = await this.initiate(plugin, payment, attempt, input);
      if (outcome.kind === 'unavailable' || outcome.kind === 'unknown') {
        // The attempt stays CREATED (ticket 22): never a failure.
        await this.scheduleFollowUp(outcome.kind, attempt.id, input);
        return await this.unchanged(scope, payment.id, attempt.id);
      }
      return await this.recordOutcome(scope, payment.id, attempt.id, outcome);
    } finally {
      await providerCancel;
    }
  }

  /**
   * Worker side of the initiate retry (`GatewayUnavailable`). Calls the same
   * `initiate` with the same attempt key. `GatewayUnavailable` is rethrown so
   * the queue retries it with backoff, up to its attempt limit.
   * `skipped` means the attempt is no longer `CREATED` (cancelled, expired or
   * already recorded).
   */
  async retryInitiate(
    data: InitiateAttemptJobData,
  ): Promise<'recorded' | 'skipped' | 'query-scheduled'> {
    const repos = this.runner.repositories;
    // A queued job acts on an attempt it already holds, so it looks across
    // Organizations, then works inside the Payment's own Organization.
    const paymentId = await repos.payments.findPaymentIdByAttemptId(
      ALL_ORGANIZATIONS,
      data.attemptId,
    );
    const payment = paymentId
      ? await repos.payments.findById(ALL_ORGANIZATIONS, paymentId)
      : null;
    const attempt = payment?.attempts.find((a) => a.id === data.attemptId);
    if (
      !payment ||
      !attempt ||
      payment.status !== 'PENDING' ||
      attempt.status !== 'CREATED'
    ) {
      return 'skipped';
    }
    const input: StartAttemptInput = {
      paymentId: payment.id,
      gatewayId: attempt.gatewayId,
      returnUrl: data.returnUrl,
      ...(data.description !== undefined && { description: data.description }),
    };
    const outcome = await this.initiate(
      await this.resolveGateway(
        organizationScope(payment.organizationId),
        attempt.gatewayId,
        false,
      ),
      payment,
      attempt,
      input,
    );
    if (outcome.kind === 'unavailable') throw outcome.error;
    if (outcome.kind === 'unknown') {
      await this.scheduleFollowUp('unknown', attempt.id, input);
      return 'query-scheduled';
    }
    await this.recordOutcome(
      organizationScope(payment.organizationId),
      payment.id,
      attempt.id,
      outcome,
    );
    return 'recorded';
  }

  /**
   * Queues what the error category calls for. Best-effort: if Redis is down
   * the attempt is still `CREATED` and a webhook or the expiry settles it.
   */
  private async scheduleFollowUp(
    kind: 'unavailable' | 'unknown',
    attemptId: string,
    input: StartAttemptInput,
  ): Promise<void> {
    try {
      if (kind === 'unavailable') {
        const data: InitiateAttemptJobData = {
          attemptId,
          returnUrl: input.returnUrl,
          ...(input.description !== undefined && {
            description: input.description,
          }),
        };
        await this.initiateQueue.add(INITIATE_ATTEMPT_JOB, data, {
          jobId: jobIds.attempt(attemptId),
          ...INITIATE_ATTEMPT_JOB_OPTIONS,
        });
      } else {
        const data: QueryAttemptJobData = { attemptId };
        await this.queryQueue.add(QUERY_ATTEMPT_JOB, data, {
          jobId: jobIds.attempt(attemptId),
          ...QUERY_ATTEMPT_JOB_OPTIONS,
          delay: UNKNOWN_OUTCOME_QUERY_DELAY_MS,
        });
      }
    } catch (error) {
      this.logger.error(
        `Could not queue follow-up (${kind}) for attempt ${attemptId}: ${String(error)}`,
      );
    }
  }

  /** The Payment and the attempt as stored, nothing changed. */
  private async unchanged(
    scope: OrganizationScope,
    paymentId: string,
    attemptId: string,
  ): Promise<StartAttemptResult> {
    const payment = await this.runner.repositories.payments.findById(
      scope,
      paymentId,
    );
    const attempt = payment?.attempts.find((a) => a.id === attemptId);
    if (!payment || !attempt) {
      throw new Error(`Attempt ${attemptId} vanished from ${paymentId}`);
    }
    return { payment, attempt };
  }

  /**
   * A new attempt needs an enabled Gateway Connection of the Organization;
   * a retry of an attempt already started works on a disabled one too.
   */
  private async resolveGateway(
    scope: OrganizationScope,
    gatewayId: string,
    isNewAttempt: boolean,
  ): Promise<PaymentGateway> {
    if (!this.gateways.isRegistered(gatewayId)) {
      throw new UnknownGatewayIdError(gatewayId);
    }
    try {
      return isNewAttempt
        ? await this.plugins.forStart(scope.organizationId, gatewayId)
        : await this.plugins.forExisting(scope.organizationId, gatewayId);
    } catch (error) {
      if (error instanceof UnknownGatewayError) {
        throw new UnknownGatewayIdError(gatewayId);
      }
      throw error;
    }
  }

  /** Step 1: one short transaction under the Payment lock. */
  private openAttempt(
    scope: OrganizationScope,
    input: StartAttemptInput,
  ): Promise<{
    payment: Payment;
    attempt: PaymentTransaction;
    /** Open attempts cancelled by this gateway switch (at most one). */
    switchedFrom: CancellableAttempt[];
  }> {
    return this.runner.run(async (repos) => {
      const payment = await repos.payments.findForUpdate(
        scope,
        input.paymentId,
      );
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

      const attempt = await repos.payments.createAttempt(scope, {
        id: newId(),
        paymentId: payment.id,
        gatewayId: input.gatewayId,
        status: INITIAL_ATTEMPT_STATUS,
      });
      await repos.statusTransitions.record(scope, {
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
      // Both leave the attempt CREATED; the caller schedules the follow-up.
      // The category and the retryable flag decide, never the provider.
      if (error instanceof GatewayUnavailableError && error.retryable) {
        return { kind: 'unavailable', error };
      }
      if (error instanceof OutcomeUnknownError) {
        return { kind: 'unknown', error };
      }
      throw error;
    }
  }

  /** Step 3: one short transaction that re-checks state before writing. */
  private recordOutcome(
    scope: OrganizationScope,
    paymentId: string,
    attemptId: string,
    outcome: RecordableOutcome,
  ): Promise<StartAttemptResult> {
    return this.runner.run(async (repos) => {
      const payment = await repos.payments.findForUpdate(scope, paymentId);
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

      const after = await repos.payments.findById(scope, paymentId);
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
  const scope = organizationScope(attempt.organizationId);
  await repos.gatewayRawResponses.record(scope, {
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
    await repos.payments.updateAttempt(scope, attempt.id, providerData);
  }
}

function gatewayCurrency(currency: string): GatewayCurrency {
  if (currency !== 'VND') throw new UnsupportedCurrencyError(currency);
  return currency;
}
