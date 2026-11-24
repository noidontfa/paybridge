import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../domain/clock.js';
import type { WebhookInboxEntry } from '../../domain/records.js';
import { GatewayManager } from '../../gateway-manager/gateway-manager.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import type {
  CallbackResult,
  HandledCallback,
  HeaderValues,
} from '../../port/index.js';
import {
  applyProviderOutcome,
  type AppliedProviderOutcome,
} from '../apply-provider-outcome.js';
import { BestEffortCancel } from '../best-effort-cancel.js';

/**
 * What one processing job did:
 * - `processed`: the callback was applied (possibly as a no-op repeat) and the
 *   inbox row is `PROCESSED`.
 * - `skipped`: the row is missing, already `PROCESSED`, or another worker is
 *   processing it.
 * - `failed`: the row could not be applied and is `FAILED` with the error;
 *   the inbox sweep (ticket 26) retries it.
 */
export type ProcessWebhookResult = 'processed' | 'skipped' | 'failed';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The callback names an attempt Core does not have. */
export class UnknownCallbackAttemptError extends Error {
  constructor(attemptKey: string) {
    super(`Callback names attempt ${attemptKey}, which Core does not know`);
    this.name = 'UnknownCallbackAttemptError';
  }
}

/**
 * Webhook processing worker service (spec: Use cases, `processWebhook`).
 * Runs for one webhook inbox row:
 *
 * 1. Claim the row (`PROCESSING`, lock time, one more try).
 * 2. Re-parse the stored callback through its plugin, with no transaction
 *    open (the plugin verifies it again and normalises the outcome).
 * 3. One transaction: lock the Payment, apply the outcome
 *    (`applyProviderOutcome`: transitions, status trail, outbox) and mark the
 *    row `PROCESSED`.
 * 4. After commit, ask providers to cancel attempts cancelled in step 3,
 *    best-effort.
 *
 * Any error rolls step 3 back and leaves the row `FAILED` with the error.
 */
@Injectable()
export class ProcessWebhook {
  private readonly logger = new Logger(ProcessWebhook.name);

  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(BestEffortCancel) private readonly cancels: BestEffortCancel,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async execute(inboxId: string): Promise<ProcessWebhookResult> {
    const inbox = this.runner.repositories.webhookInbox;
    const entry = await inbox.claim(inboxId, this.clock.now());
    if (!entry) return 'skipped';

    let applied: AppliedProviderOutcome;
    try {
      const callback = await this.parse(entry);
      if (callback.ignored) {
        await inbox.markProcessed(entry.id, this.clock.now());
        return 'processed';
      }
      applied = await this.apply(entry, callback);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Processing webhook inbox row ${entry.id} (${entry.gatewayId}) failed: ${message}`,
      );
      await inbox.markFailed(entry.id, message);
      return 'failed';
    }

    if (applied.cancelledAttempts.length > 0) {
      await this.cancels.cancel(applied.cancelledAttempts);
    }
    return 'processed';
  }

  private parse(entry: WebhookInboxEntry): Promise<CallbackResult> {
    const plugin = this.gateways.resolve(entry.gatewayId);
    return plugin.parseCallback({
      rawBody: entry.rawBody,
      headers: entry.headers as HeaderValues,
      query: entry.query as HeaderValues,
    });
  }

  private apply(
    entry: WebhookInboxEntry,
    callback: HandledCallback,
  ): Promise<AppliedProviderOutcome> {
    const attemptKey = callback.attemptKey;
    return this.runner.run(async (repos) => {
      const paymentId = UUID.test(attemptKey)
        ? await repos.payments.findPaymentIdByAttemptId(attemptKey)
        : null;
      if (!paymentId) throw new UnknownCallbackAttemptError(attemptKey);
      const payment = await repos.payments.findForUpdate(paymentId);
      if (!payment) throw new UnknownCallbackAttemptError(attemptKey);

      const now = this.clock.now();
      const applied = await applyProviderOutcome(repos, {
        payment,
        attemptId: attemptKey.toLowerCase(),
        outcome: callback,
        cause: { trigger: 'webhook', actor: 'system' },
        now,
      });
      await repos.webhookInbox.markProcessed(entry.id, now);
      return applied;
    });
  }
}
