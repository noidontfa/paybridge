import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../../infrastructure/queue/queue.constants.js';
import { ReviewRequerySweep } from '../review-requery-sweep.js';

/** Worker of the sweep queue: runs the review re-query sweep per scheduled job. */
@Processor(QUEUES.reviewRequerySweep)
export class ReviewRequerySweepProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewRequerySweepProcessor.name);

  constructor(
    @Inject(ReviewRequerySweep) private readonly sweep: ReviewRequerySweep,
  ) {
    super();
  }

  process(_job: Job): Promise<{ queued: number }> {
    return this.sweep.run();
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Review re-query sweep failed: ${error.message}`);
  }
}
