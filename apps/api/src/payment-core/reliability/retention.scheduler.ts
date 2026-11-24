import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../infrastructure/queue/queue.constants.js';

/** Id of the job scheduler, shared by every instance. */
export const RETENTION_SCHEDULER_ID = 'retention';
export const RETENTION_JOB = 'retention';
/** Hourly: the retention windows are one day or longer. */
export const RETENTION_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the retention cleanup as a BullMQ job scheduler at boot.
 * Upserting by a fixed id is idempotent, so any number of instances (and
 * restarts) leave exactly one schedule in Redis.
 *
 * Runs try once (the next hour is the retry), are removed when they complete,
 * and the last 50 failures are kept for inspection.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.retention) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RETENTION_SCHEDULER_ID,
      { every: RETENTION_EVERY_MS },
      {
        name: RETENTION_JOB,
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
