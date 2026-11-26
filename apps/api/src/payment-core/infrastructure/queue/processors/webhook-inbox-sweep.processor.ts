import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue.constants.js';
import {
  WebhookInboxSweep,
  type WebhookInboxSweepResult,
} from '../../../application/sweeps/webhook-inbox-sweep.js';

/** Worker of the inbox sweep queue: one sweep per scheduled job. */
@Processor(QUEUES.webhookInboxSweep)
export class WebhookInboxSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookInboxSweepProcessor.name);

  constructor(
    @Inject(WebhookInboxSweep) private readonly sweep: WebhookInboxSweep,
  ) {
    super();
  }

  process(_job: Job): Promise<WebhookInboxSweepResult> {
    return this.sweep.run();
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Webhook inbox sweep failed: ${error.message}`);
  }
}
