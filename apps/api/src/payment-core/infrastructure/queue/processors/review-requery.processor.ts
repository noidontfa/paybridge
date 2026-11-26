import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  RequeryAttempt,
  type RequeryAttemptResult,
} from '../../../application/workers/requery-attempt.js';
import { QUEUES } from '../queue.constants.js';
import {
  REVIEW_REQUERY_JOB,
  type ReviewRequeryJobData,
} from '../../../application/sweeps/review-requery-sweep.js';

/** Worker of the review re-query queue: runs `RequeryAttempt.executeReview`. */
@Processor(QUEUES.reviewRequery)
export class ReviewRequeryProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewRequeryProcessor.name);

  constructor(
    @Inject(RequeryAttempt) private readonly requery: RequeryAttempt,
  ) {
    super();
  }

  async process(
    job: Job<ReviewRequeryJobData>,
  ): Promise<RequeryAttemptResult | undefined> {
    if (job.name !== REVIEW_REQUERY_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
      return undefined;
    }
    return this.requery.executeReview(job.data.attemptId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ReviewRequeryJobData> | undefined, error: Error): void {
    this.logger.error(
      `Review re-query of attempt ${job?.data.attemptId ?? '?'} failed (try ${job?.attemptsMade ?? '?'}): ${error.message}`,
    );
  }
}
