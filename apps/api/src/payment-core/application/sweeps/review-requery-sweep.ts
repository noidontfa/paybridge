import { ALL_ORGANIZATIONS } from '../../domain/value-objects/organization-scope.js';
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../domain/services/clock.js';
import { REQUERIED_REVIEW_REASONS } from '../../domain/rules/apply-outcome.js';
import { REVIEW_REQUERY_WINDOW_MS } from '../../domain/rules/review-requery.js';
import {
  JobDispatcher,
  type JobOptions,
} from '../../domain/services/job-dispatcher.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';

/** Job name of one attempt in review to re-query, on the review-requery queue. */
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
export function reviewRequeryJobOptions(): JobOptions {
  return {
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
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
  ) {}

  async run(): Promise<{ queued: number }> {
    const openedAfter = new Date(
      this.clock.now().getTime() - REVIEW_REQUERY_WINDOW_MS,
    );
    const ids =
      await this.runner.repositories.payments.findReviewRequeryAttemptIds(
        ALL_ORGANIZATIONS,
        REQUERIED_REVIEW_REASONS,
        openedAfter,
        REVIEW_REQUERY_BATCH_SIZE,
      );
    if (ids.length === 0) return { queued: 0 };
    await this.dispatcher.enqueueMany(
      'reviewRequery',
      ids.map((attemptId) => ({
        name: REVIEW_REQUERY_JOB,
        jobId: attemptId,
        data: { attemptId } satisfies ReviewRequeryJobData,
        options: reviewRequeryJobOptions(),
      })),
    );
    return { queued: ids.length };
  }
}
