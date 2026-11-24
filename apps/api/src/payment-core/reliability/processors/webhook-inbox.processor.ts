import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  PROCESS_WEBHOOK_JOB,
  type ProcessWebhookJobData,
} from '../../application/webhook-intake.js';
import {
  ProcessWebhook,
  type ProcessWebhookResult,
} from '../../application/workers/process-webhook.js';
import { QUEUES } from '../../infrastructure/queue/queue.constants.js';

/**
 * Worker of the webhook inbox queue: runs `ProcessWebhook` for each stored
 * callback that intake (or the inbox sweep) dispatched. A failure is recorded
 * on the inbox row, not as a BullMQ retry: PostgreSQL decides what is retried
 * (ADR 0002).
 */
@Processor(QUEUES.webhookInbox)
export class WebhookInboxProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookInboxProcessor.name);

  constructor(
    @Inject(ProcessWebhook) private readonly processWebhook: ProcessWebhook,
  ) {
    super();
  }

  async process(
    job: Job<ProcessWebhookJobData>,
  ): Promise<ProcessWebhookResult | undefined> {
    if (job.name !== PROCESS_WEBHOOK_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
      return undefined;
    }
    return this.processWebhook.execute(job.data.inboxId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProcessWebhookJobData> | undefined, error: Error): void {
    this.logger.error(
      `Webhook inbox job ${job?.data.inboxId ?? '?'} failed: ${error.message}`,
    );
  }
}
