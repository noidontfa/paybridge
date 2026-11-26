import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue.constants.js';
import { ExpirySweep } from '../../../application/sweeps/expiry-sweep.js';

/**
 * Worker of the sweep queue: runs the expiry sweep for each `expiry-sweep`
 * job the scheduler produces. The sweep has its own queue so the expiry
 * queue's worker can be rate-limited for provider queries (ticket 24) without
 * delaying the sweep.
 */
@Processor(QUEUES.expirySweep)
export class ExpirySweepProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpirySweepProcessor.name);

  constructor(@Inject(ExpirySweep) private readonly sweep: ExpirySweep) {
    super();
  }

  process(_job: Job): Promise<{ queued: number }> {
    return this.sweep.run();
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Expiry sweep failed: ${error.message}`);
  }
}
