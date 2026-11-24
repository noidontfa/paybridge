import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  INITIATE_ATTEMPT_JOB,
  StartAttempt,
  type InitiateAttemptJobData,
} from '../../application/use-cases/start-attempt.js';
import { QUEUES } from '../../infrastructure/queue/queue.constants.js';

/**
 * Worker of the initiate retry queue (ticket 22): repeats `initiate` for an
 * attempt left `CREATED` by a `GatewayUnavailable`. A thrown error makes
 * BullMQ retry with backoff, up to the job's attempt limit.
 */
@Processor(QUEUES.attemptInitiate)
export class AttemptInitiateProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptInitiateProcessor.name);

  constructor(@Inject(StartAttempt) private readonly start: StartAttempt) {
    super();
  }

  async process(job: Job<InitiateAttemptJobData>): Promise<string | undefined> {
    if (job.name !== INITIATE_ATTEMPT_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
      return undefined;
    }
    return this.start.retryInitiate(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<InitiateAttemptJobData> | undefined, error: Error): void {
    this.logger.error(
      `Initiate retry of attempt ${job?.data.attemptId ?? '?'} failed (try ${job?.attemptsMade ?? '?'}/${job?.opts.attempts ?? '?'}): ${error.message}`,
    );
  }
}
