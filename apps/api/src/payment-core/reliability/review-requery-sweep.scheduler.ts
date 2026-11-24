import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../infrastructure/queue/queue.constants.js';

/** Id of the job scheduler, shared by every instance. */
export const REVIEW_REQUERY_SWEEP_SCHEDULER_ID = 'review-requery-sweep';
export const REVIEW_REQUERY_SWEEP_JOB = 'review-requery-sweep';
/** Reviews are slow-moving (72 hour window): every 10 minutes is enough. */
export const REVIEW_REQUERY_SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Registers the review re-query sweep as a BullMQ job scheduler at boot.
 * Upserting by a fixed id is idempotent, so any number of instances (and
 * restarts) leave exactly one schedule in Redis. Same job options as the
 * expiry sweep scheduler: one try, the next run is the retry.
 */
@Injectable()
export class ReviewRequerySweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.reviewRequerySweep) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REVIEW_REQUERY_SWEEP_SCHEDULER_ID,
      { every: REVIEW_REQUERY_SWEEP_EVERY_MS },
      {
        name: REVIEW_REQUERY_SWEEP_JOB,
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
