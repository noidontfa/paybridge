import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  QUERY_ATTEMPT_JOB,
  type QueryAttemptJobData,
} from '../../../application/use-cases/handle-browser-return.js';
import {
  RequeryAttempt,
  type RequeryAttemptResult,
} from '../../../application/workers/requery-attempt.js';
import { QUEUES } from '../queue.constants.js';

/** Worker of the status query queue: runs `RequeryAttempt` per attempt. */
@Processor(QUEUES.attemptStatusQuery)
export class AttemptStatusQueryProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptStatusQueryProcessor.name);

  constructor(
    @Inject(RequeryAttempt) private readonly requery: RequeryAttempt,
  ) {
    super();
  }

  async process(
    job: Job<QueryAttemptJobData>,
  ): Promise<RequeryAttemptResult | undefined> {
    if (job.name !== QUERY_ATTEMPT_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
      return undefined;
    }
    return this.requery.execute(job.data.attemptId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<QueryAttemptJobData> | undefined, error: Error): void {
    this.logger.error(
      `Status query of attempt ${job?.data.attemptId ?? '?'} failed (try ${job?.attemptsMade ?? '?'}): ${error.message}`,
    );
  }
}
