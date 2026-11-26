import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue.constants.js';
import {
  RetentionCleanup,
  type RetentionResult,
} from '../../../application/sweeps/retention.js';

/** Worker of the retention queue: one cleanup run per scheduled job. */
@Processor(QUEUES.retention)
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    @Inject(RetentionCleanup) private readonly cleanup: RetentionCleanup,
  ) {
    super();
  }

  process(_job: Job): Promise<RetentionResult> {
    return this.cleanup.run();
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Retention cleanup failed: ${error.message}`);
  }
}
