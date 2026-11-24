import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../domain/clock.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Idempotency records are deleted this long after their expiry time. */
export const IDEMPOTENCY_RETENTION_AFTER_EXPIRY_MS = DAY_MS;
/** Published outbox rows are deleted this long after publication. */
export const OUTBOX_RETENTION_AFTER_PUBLISH_MS = 7 * DAY_MS;
/** Webhook inbox rows (except `FAILED`) are deleted this long after receipt. */
export const WEBHOOK_INBOX_RETENTION_MS = 90 * DAY_MS;

/** Rows deleted by one run, per table. */
export interface RetentionResult {
  readonly idempotencyKeys: number;
  readonly outboxEvents: number;
  readonly webhookInbox: number;
}

/**
 * Retention cleanup (spec: Reliability, Retention). Deletes only rows the
 * spec lets expire. Audit data (status transitions), raw gateway responses,
 * unpublished outbox rows and `FAILED` webhook inbox rows are never touched.
 * Runs from the `retention` job scheduler; each delete is idempotent, so a
 * repeated or overlapping run is harmless.
 */
@Injectable()
export class RetentionCleanup {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async run(): Promise<RetentionResult> {
    const now = this.clock.now().getTime();
    const before = (ms: number): Date => new Date(now - ms);
    const repos = this.runner.repositories;
    const idempotencyKeys = await repos.idempotencyKeys.deleteExpiredBefore(
      before(IDEMPOTENCY_RETENTION_AFTER_EXPIRY_MS),
    );
    const outboxEvents = await repos.outbox.deletePublishedBefore(
      before(OUTBOX_RETENTION_AFTER_PUBLISH_MS),
    );
    const webhookInbox = await repos.webhookInbox.deleteReceivedBefore(
      before(WEBHOOK_INBOX_RETENTION_MS),
    );
    return { idempotencyKeys, outboxEvents, webhookInbox };
  }
}
