import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../infrastructure/queue/queue.constants.js';

/** Id of the job scheduler, shared by every instance. */
export const WEBHOOK_INBOX_SWEEP_SCHEDULER_ID = 'webhook-inbox-sweep';
export const WEBHOOK_INBOX_SWEEP_JOB = 'webhook-inbox-sweep';
/** The sweep cadence; it bounds how long a stuck callback waits. */
export const WEBHOOK_INBOX_SWEEP_EVERY_MS = 60_000;

/**
 * Registers the webhook inbox sweep as a BullMQ job scheduler at boot.
 * Upserting by a fixed id is idempotent, so any number of instances (and
 * restarts) leave exactly one schedule in Redis.
 *
 * Runs try once (the next minute is the retry), are removed when they
 * complete, and the last 50 failures are kept for inspection.
 */
@Injectable()
export class WebhookInboxSweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.webhookInboxSweep) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      WEBHOOK_INBOX_SWEEP_SCHEDULER_ID,
      { every: WEBHOOK_INBOX_SWEEP_EVERY_MS },
      {
        name: WEBHOOK_INBOX_SWEEP_JOB,
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
