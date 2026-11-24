import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { Clock } from '../domain/clock.js';
import { REQUERIED_REVIEW_REASONS } from '../domain/rules/apply-outcome.js';
import { REVIEW_REQUERY_WINDOW_MS } from '../domain/rules/review-requery.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../infrastructure/queue/queue.constants.js';

/** Job name of one attempt in review to re-query, on `QUEUES.reviewRequery`. */
export const REVIEW_REQUERY_JOB = 'requery-review';

export interface ReviewRequeryJobData {
  readonly attemptId: string;
}

/** Most attempts queued per sweep run. */
export const REVIEW_REQUERY_BATCH_SIZE = 100;

/**
 * Options of every `requery-review` job. `jobId` = attempt id (one job per
 * attempt, however often it is queued). Jobs are removed when they end, so the
 * next sweep can queue the same attempt again: a review that is still unclear
 * is simply queried again on the next run. Three tries ride out a provider
 * hiccup.
 */
export function reviewRequeryJobOptions(attemptId: string): JobsOptions {
  return {
    jobId: jobIds.attempt(attemptId),
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/**
 * Review re-query sweep (spec: Review exit, ticket 28). Reads attempts in
 * `REQUIRES_REVIEW` with reason `AMBIGUOUS_PROVIDER_STATUS` or
 * `AMOUNT_MISMATCH` whose review opened less than 72 hours ago, and queues
 * each on the re-query queue. Older reviews are left for an operator. It
 * writes nothing to PostgreSQL, so a lost Redis changes no state (ADR 0002).
 */
@Injectable()
export class ReviewRequerySweep {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @InjectQueue(QUEUES.reviewRequery) private readonly queue: Queue,
  ) {}

  async run(): Promise<{ queued: number }> {
    const openedAfter = new Date(
      this.clock.now().getTime() - REVIEW_REQUERY_WINDOW_MS,
    );
    const ids =
      await this.runner.repositories.payments.findReviewRequeryAttemptIds(
        REQUERIED_REVIEW_REASONS,
        openedAfter,
        REVIEW_REQUERY_BATCH_SIZE,
      );
    if (ids.length === 0) return { queued: 0 };
    await this.queue.addBulk(
      ids.map((attemptId) => ({
        name: REVIEW_REQUERY_JOB,
        data: { attemptId } satisfies ReviewRequeryJobData,
        opts: reviewRequeryJobOptions(attemptId),
      })),
    );
    return { queued: ids.length };
  }
}
