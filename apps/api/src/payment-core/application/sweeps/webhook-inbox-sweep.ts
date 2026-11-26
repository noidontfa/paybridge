import { ALL_ORGANIZATIONS } from '../../domain/value-objects/organization-scope.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESS_WEBHOOK_JOB,
  PROCESS_WEBHOOK_JOB_OPTIONS,
  type ProcessWebhookJobData,
} from '../webhook-intake.js';
import { Clock } from '../../domain/services/clock.js';
import { JobDispatcher } from '../../domain/services/job-dispatcher.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { AlertSink, AlertThrottle } from '../../domain/services/alert.js';

/** A `PROCESSING` row locked longer ago than this lost its worker. */
export const WEBHOOK_INBOX_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
/** Retries after the first processing try; then the row is left and alerted. */
export const WEBHOOK_INBOX_MAX_RETRIES = 5;
/** Rows dispatched (and exhausted rows alerted) per run. */
export const WEBHOOK_INBOX_SWEEP_BATCH_SIZE = 100;
/** An exhausted row is alerted again after this long, not every minute. */
export const WEBHOOK_INBOX_ALERT_REPEAT_SECONDS = 60 * 60;

export interface WebhookInboxSweepResult {
  readonly reset: number;
  readonly dispatched: number;
  readonly alerted: number;
}

/**
 * Webhook inbox sweep (spec: Reliability, Webhook inbox). Runs every minute
 * from the `webhook-inbox-sweep` job scheduler:
 *
 * 1. `PROCESSING` rows locked over 5 minutes ago go back to `RECEIVED`.
 * 2. `RECEIVED` rows and `FAILED` rows with retries left are dispatched on the
 *    webhook inbox queue (job id = row id). The worker's claim counts each
 *    try in `attempts` and records `lastError`, so the sweep does not.
 * 3. `FAILED` rows that used up their 5 retries stay `FAILED` and raise an
 *    alert, repeated hourly while the row stays unhandled.
 *
 * Processing the same row twice is safe: the claim lets one worker in, and a
 * `PROCESSED` row is never claimed again.
 */
@Injectable()
export class WebhookInboxSweep {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(AlertSink) private readonly alerts: AlertSink,
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
    @Inject(AlertThrottle) private readonly throttle: AlertThrottle,
  ) {}

  async run(): Promise<WebhookInboxSweepResult> {
    const inbox = this.runner.repositories.webhookInbox;
    const now = this.clock.now();

    const reset = await inbox.resetStaleProcessing(
      ALL_ORGANIZATIONS,
      new Date(now.getTime() - WEBHOOK_INBOX_LOCK_TIMEOUT_MS),
    );

    // `attempts` counts every try, the first one included.
    const maxTries = WEBHOOK_INBOX_MAX_RETRIES + 1;
    const ids = await inbox.findDispatchableIds(
      ALL_ORGANIZATIONS,
      maxTries - 1,
      WEBHOOK_INBOX_SWEEP_BATCH_SIZE,
    );
    if (ids.length > 0) {
      await this.dispatcher.enqueueMany(
        'webhookInbox',
        ids.map((inboxId) => ({
          name: PROCESS_WEBHOOK_JOB,
          jobId: inboxId,
          data: { inboxId } satisfies ProcessWebhookJobData,
          options: PROCESS_WEBHOOK_JOB_OPTIONS,
        })),
      );
    }

    const exhausted = await inbox.findExhausted(
      ALL_ORGANIZATIONS,
      maxTries - 1,
      WEBHOOK_INBOX_SWEEP_BATCH_SIZE,
    );
    let alerted = 0;
    for (const row of exhausted) {
      if (!(await this.firstAlertInWindow(row.id))) continue;
      await this.alerts.raise({
        code: 'webhook-inbox.exhausted',
        message: `Webhook inbox row ${row.id} failed after ${WEBHOOK_INBOX_MAX_RETRIES} retries and needs manual handling`,
        details: {
          inboxId: row.id,
          gatewayId: row.gatewayId,
          attempts: row.attempts,
          lastError: row.lastError,
        },
      });
      alerted += 1;
    }
    return { reset, dispatched: ids.length, alerted };
  }

  /** True once per row per window; see `AlertThrottle`. */
  private firstAlertInWindow(inboxId: string): Promise<boolean> {
    return this.throttle.claim(
      `webhook-inbox:${inboxId}`,
      WEBHOOK_INBOX_ALERT_REPEAT_SECONDS,
    );
  }
}
