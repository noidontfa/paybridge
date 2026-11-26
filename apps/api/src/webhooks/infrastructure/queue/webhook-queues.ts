import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { DeliveryDispatcher } from '../../domain/services/ports.js';

/** The webhooks module's own queues (Payment Events come from `core-outbox`). */
export const WEBHOOK_QUEUES = {
  /** One attempt of one delivery. Job id: the delivery id. */
  delivery: 'wh-delivery',
} as const;

export const DELIVER_WEBHOOK_JOB = 'deliver';

export interface DeliverWebhookJobData {
  readonly deliveryId: string;
}

const HOUR_S = 60 * 60;

/**
 * PostgreSQL decides what is delivered (ADR 0002): a job only says "try this
 * delivery now". Completed jobs are kept a day so a repeated hand-off of the
 * same delivery is a no-op while they exist.
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
  ) {
    super();
  }

  async dispatch(deliveryIds: readonly string[]): Promise<void> {
    if (deliveryIds.length === 0) return;
    await this.queue.addBulk(
      deliveryIds.map((deliveryId) => ({
        name: DELIVER_WEBHOOK_JOB,
        data: { deliveryId } satisfies DeliverWebhookJobData,
        opts: { ...DELIVERY_JOB_OPTIONS, jobId: deliveryId.toLowerCase() },
      })),
    );
  }
}
