import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../infrastructure/queue/queue.constants.js';

/** Id of the job scheduler, shared by every instance. */
export const EXPIRY_SWEEP_SCHEDULER_ID = 'expiry-sweep';
export const EXPIRY_SWEEP_JOB = 'expiry-sweep';
/** The sweep cadence; it bounds expiry latency to about one minute. */
export const EXPIRY_SWEEP_EVERY_MS = 60_000;

/**
 * Registers the expiry sweep as a BullMQ job scheduler at boot. Upserting by
 * a fixed id is idempotent, so any number of instances (and restarts) leave
 * exactly one schedule in Redis.
 *
 * Sweep jobs try once (the next minute is the retry), are removed when they
 * complete, and the last 50 failures are kept for inspection. Each run has its
 * own job id, so kept failures never block later runs.
 */
@Injectable()
export class ExpirySweepScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.expirySweep) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      EXPIRY_SWEEP_SCHEDULER_ID,
      { every: EXPIRY_SWEEP_EVERY_MS },
      {
        name: EXPIRY_SWEEP_JOB,
        data: {},
        opts: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: { count: 50 },
        },
      },
    );
  }
}
