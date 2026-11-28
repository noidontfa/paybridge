import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { WebhookDeliverySweep } from '../../application/sweeps/webhook-delivery-sweep.js';
import { WebhookRetention } from '../../application/sweeps/webhook-retention.js';
import { WEBHOOK_QUEUES } from './webhook-queues.js';

/** Job names; each is also its job scheduler's id, shared by every instance. */
export const WEBHOOK_DELIVERY_SWEEP_JOB = 'wh-delivery-sweep';
export const WEBHOOK_RETENTION_JOB = 'wh-retention';
/** The sweep cadence; it bounds how late a lost retry runs. */
export const WEBHOOK_DELIVERY_SWEEP_EVERY_MS = 60_000;
/** Hourly: the retention window is days long. */
export const WEBHOOK_RETENTION_EVERY_MS = 60 * 60 * 1000;

const RUN_OPTIONS = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: { count: 50 },
} as const;

/**
 * Registers the delivery sweep and retention as BullMQ job schedulers at boot.
 * Upserting by a fixed id is idempotent, so any number of instances (and
 * restarts) leave exactly one schedule of each in Redis. Runs try once (the
 * next run is the retry), as Core's schedulers do.
 */
@Injectable()
export class WebhookMaintenanceScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(WEBHOOK_QUEUES.maintenance) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const [name, every] of [
      [WEBHOOK_DELIVERY_SWEEP_JOB, WEBHOOK_DELIVERY_SWEEP_EVERY_MS],
      [WEBHOOK_RETENTION_JOB, WEBHOOK_RETENTION_EVERY_MS],
    ] as const) {
      await this.queue.upsertJobScheduler(
        name,
        { every },
        { name, data: {}, opts: RUN_OPTIONS },
      );
    }
  }
}

/** Worker of the maintenance queue: one sweep or cleanup per job. */
@Processor(WEBHOOK_QUEUES.maintenance)
export class WebhookMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookMaintenanceProcessor.name);

  constructor(
    @Inject(WebhookDeliverySweep) private readonly sweep: WebhookDeliverySweep,
    @Inject(WebhookRetention) private readonly retention: WebhookRetention,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case WEBHOOK_DELIVERY_SWEEP_JOB:
        return this.sweep.run();
      case WEBHOOK_RETENTION_JOB:
        return this.retention.run();
      default:
        this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
        return undefined;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `${job?.name ?? 'Webhook upkeep'} failed: ${error.message}`,
    );
  }
}
