import { ALL_ORGANIZATIONS } from '../domain/organization-scope.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  PROCESS_WEBHOOK_JOB,
  PROCESS_WEBHOOK_JOB_OPTIONS,
  type ProcessWebhookJobData,
} from '../application/webhook-intake.js';
import { Clock } from '../domain/clock.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../infrastructure/queue/queue.constants.js';
import { AlertSink } from './alert.js';

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
    @InjectQueue(QUEUES.webhookInbox) private readonly queue: Queue,
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
      await this.queue.addBulk(
        ids.map((inboxId) => ({
          name: PROCESS_WEBHOOK_JOB,
          data: { inboxId } satisfies ProcessWebhookJobData,
          opts: {
            jobId: jobIds.webhookInbox(inboxId),
            ...PROCESS_WEBHOOK_JOB_OPTIONS,
          },
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

  /**
   * True once per row per window. A Redis key with a TTL marks the alert as
   * sent; only one sweep job runs per minute, so check-then-set is enough.
   */
  private async firstAlertInWindow(inboxId: string): Promise<boolean> {
    const prefix = this.queue.opts?.prefix ?? 'bull';
    const client = await this.queue.getBackend().client;
    const key = `${prefix}:alerts:webhook-inbox:${inboxId}`;
    if ((await client.get(key)) !== null) return false;
    await client.set(key, '1', { EX: WEBHOOK_INBOX_ALERT_REPEAT_SECONDS });
    return true;
  }
}
