import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import {
  DeliveryDispatcher,
  WebhooksClock,
  type DeliveryAttemptRef,
} from '../../domain/services/ports.js';

/** The webhooks module's own queues (Payment Events come from `core-outbox`). */
export const WEBHOOK_QUEUES = {
  /** One attempt of one delivery. Job id: see `deliveryJobId`. */
  delivery: 'wh-delivery',
  /** Scheduled upkeep: the delivery sweep and retention. */
  maintenance: 'wh-maintenance',
} as const;

export const DELIVER_WEBHOOK_JOB = 'deliver';

export interface DeliverWebhookJobData {
  readonly deliveryId: string;
}

/**
 * The job id of one attempt: the delivery id for the first, then
 * `<delivery id>-<attempt>`. BullMQ ids must not contain `:`.
 */
export function deliveryJobId({ deliveryId, attempt }: DeliveryAttemptRef) {
  const id = deliveryId.toLowerCase();
  return attempt <= 1 ? id : `${id}-${attempt}`;
}

const HOUR_S = 60 * 60;

/**
 * PostgreSQL decides what is delivered (ADR 0002): a job only says "try this
 * delivery now". Completed jobs are kept a day so a repeated hand-off of the
 * same attempt is a no-op while they exist.
 */
const DELIVERY_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 24 * HOUR_S },
  removeOnFail: { age: 7 * 24 * HOUR_S },
} as const satisfies JobsOptions;

@Injectable()
export class BullDeliveryDispatcher extends DeliveryDispatcher {
  constructor(
    @InjectQueue(WEBHOOK_QUEUES.delivery) private readonly queue: Queue,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
  ) {
    super();
  }

  async dispatch(deliveryIds: readonly string[]): Promise<void> {
    if (deliveryIds.length === 0) return;
    await this.queue.addBulk(
      deliveryIds.map((deliveryId) => this.job({ deliveryId, attempt: 1 })),
    );
  }

  async schedule(ref: DeliveryAttemptRef, at: Date): Promise<void> {
    const delay = Math.max(0, at.getTime() - this.clock.now().getTime());
    const { name, data, opts } = this.job(ref);
    await this.queue.add(name, data, { ...opts, delay });
  }

  async redispatch(refs: readonly DeliveryAttemptRef[]): Promise<void> {
    for (const ref of refs) {
      const job = await this.queue.getJob(deliveryJobId(ref));
      const state = job ? await job.getState() : 'unknown';
      if (state === 'delayed') {
        // Due by PostgreSQL's clock: run it now.
        await job!.promote();
        continue;
      }
      if (state === 'waiting' || state === 'active' || state === 'prioritized') {
        continue;
      }
      // Lost from Redis, or it ended without recording the attempt (it
      // threw, or found the delivery held by a worker that then vanished).
      if (job) await job.remove();
      const { name, data, opts } = this.job(ref);
      await this.queue.add(name, data, opts);
    }
  }

  private job(ref: DeliveryAttemptRef) {
    return {
      name: DELIVER_WEBHOOK_JOB,
      data: { deliveryId: ref.deliveryId } satisfies DeliverWebhookJobData,
      opts: { ...DELIVERY_JOB_OPTIONS, jobId: deliveryJobId(ref) },
    };
  }
}
