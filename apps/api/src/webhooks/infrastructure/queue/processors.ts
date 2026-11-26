import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  OUTBOX_QUEUE,
  type OutboxJobData,
} from '../../../payment-core/port/outbox.js';
import {
  DeliverWebhook,
  type DeliverWebhookResult,
} from '../../application/workers/deliver-webhook.js';
import { FanOutPaymentEvent } from '../../application/workers/fan-out-payment-event.js';
import {
  DELIVER_WEBHOOK_JOB,
  WEBHOOK_QUEUES,
  type DeliverWebhookJobData,
} from './webhook-queues.js';

/**
 * The consumer of Core's Payment Events: fans each one out to the
 * Organization's subscribed Webhook Endpoints. A failure throws, so BullMQ
 * retries the job (fan-out is idempotent).
 */
@Processor(OUTBOX_QUEUE)
export class PaymentEventProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentEventProcessor.name);

  constructor(
    @Inject(FanOutPaymentEvent) private readonly fanOut: FanOutPaymentEvent,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<{ deliveries: number }> {
    const data = job.data;
    if (!data.organizationId) {
      this.logger.warn(`Payment Event ${job.id} has no Organization; skipped`);
      return { deliveries: 0 };
    }
    return this.fanOut.execute({
      eventId: data.outboxEventId,
      organizationId: data.organizationId,
      eventType: data.eventType,
      paymentId: data.paymentId,
      createdAt: new Date(data.createdAt),
      payload: data.payload,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<OutboxJobData> | undefined, error: Error): void {
    this.logger.error(
      `Fan-out of Payment Event ${job?.data.outboxEventId ?? '?'} failed: ${error.message}`,
    );
  }
}

/** Makes one attempt of each delivery handed to it. */
@Processor(WEBHOOK_QUEUES.delivery)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    @Inject(DeliverWebhook) private readonly deliver: DeliverWebhook,
  ) {
    super();
  }

  async process(
    job: Job<DeliverWebhookJobData>,
  ): Promise<DeliverWebhookResult | undefined> {
    if (job.name !== DELIVER_WEBHOOK_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
      return undefined;
    }
    return this.deliver.execute(job.data.deliveryId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DeliverWebhookJobData> | undefined, error: Error): void {
    this.logger.error(
      `Webhook delivery ${job?.data.deliveryId ?? '?'} failed: ${error.message}`,
    );
  }
}
