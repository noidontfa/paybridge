import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobsOptions, Queue } from 'bullmq';
import {
  resolveOutboxRelayEnabled,
  type Env,
} from '../../config/env.schema.js';
import { Clock } from '../domain/clock.js';
import type { OutboxEvent, OutboxEventType } from '../domain/records.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../infrastructure/queue/queue.constants.js';

/**
 * Data of every outbox job. The job name is the event type; the job id is
 * `outboxEventId`, which consumers use to deduplicate (delivery is at least
 * once).
 */
export interface OutboxJobData {
  readonly outboxEventId: string;
  readonly eventType: OutboxEventType;
  readonly paymentId: string;
  readonly payload: unknown;
  /** ISO 8601 time the event was written. */
  readonly createdAt: string;
}

const HOUR_S = 60 * 60;

/**
 * BullMQ options of every outbox job. The relay is the only producer of the
 * outbox queue, so these are the queue's defaults.
 *
 * - The job id (outbox row id) dedupes only while a job with that id is still
 *   in Redis. Completed jobs are therefore kept for 24 hours, not removed at
 *   once: a row is re-added only while it is unpublished, which is normally
 *   the next poll (or after a database outage of less than a day), and that
 *   re-add must hit the existing job and be a no-op. After 24 hours a re-add
 *   would create a new job, so consumers must still dedupe by job id.
 * - No count limit on kept jobs: a burst must not evict recent ids early.
 * - Failed jobs are kept 7 days for inspection. A re-add while the failed job
 *   exists is also a no-op; the relay never revives failed jobs.
 * - 5 attempts with exponential backoff from 1 second, for consumers
 *   (none in this ticket).
 */
export const OUTBOX_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * HOUR_S },
  removeOnFail: { age: 7 * 24 * HOUR_S },
} as const satisfies JobsOptions;

export interface OutboxRelayOptions {
  /** Start the poll loop at application bootstrap. */
  readonly enabled: boolean;
  /** Pause between the end of one poll and the start of the next. */
  readonly pollIntervalMs: number;
  /** Rows read per query. A poll keeps reading until a batch is short. */
  readonly batchSize: number;
  /** A Redis call slower than this counts as Redis being unavailable. */
  readonly addTimeoutMs: number;
}

export const DEFAULT_OUTBOX_RELAY_OPTIONS: OutboxRelayOptions = {
  enabled: true,
  pollIntervalMs: 1_000,
  batchSize: 100,
  addTimeoutMs: 5_000,
};

export const OUTBOX_RELAY_OPTIONS = Symbol('OUTBOX_RELAY_OPTIONS');

/** Relay options from the environment (`OUTBOX_RELAY_*`). */
export const outboxRelayOptionsProvider: Provider = {
  provide: OUTBOX_RELAY_OPTIONS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): OutboxRelayOptions => ({
    ...DEFAULT_OUTBOX_RELAY_OPTIONS,
    enabled: resolveOutboxRelayEnabled({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      OUTBOX_RELAY_ENABLED: config.get('OUTBOX_RELAY_ENABLED', { infer: true }),
    }),
    pollIntervalMs: config.get('OUTBOX_RELAY_POLL_INTERVAL_MS', {
      infer: true,
    }),
    batchSize: config.get('OUTBOX_RELAY_BATCH_SIZE', { infer: true }),
  }),
};

export interface PublishResult {
  /** Rows enqueued and marked published by this call. */
  readonly published: number;
  /** True when the call stopped early because Redis or the database failed. */
  readonly failed: boolean;
}

/**
 * Outbox relay: adds each unpublished outbox row to the outbox queue with the
 * row id as job id, then sets the row's published time. It only dispatches;
 * it never deletes rows (retention does).
 *
 * If Redis is unavailable the poll stops at the first failing row, the rows
 * stay unpublished in PostgreSQL, and the next poll retries. A crash between
 * the add and the published time leaves the row unpublished, so it is added
 * again; the job id makes that a no-op. Several instances may run the relay
 * at once for the same reason.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = true;

  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @InjectQueue(QUEUES.outbox) private readonly queue: Queue,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(OUTBOX_RELAY_OPTIONS) private readonly options: OutboxRelayOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.enabled) this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Starts polling. Polls never overlap. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  /** Stops polling and waits for a poll in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Publishes every row that is unpublished when the call reaches it. */
  async publishPending(): Promise<PublishResult> {
    let published = 0;
    for (;;) {
      let rows: OutboxEvent[];
      try {
        rows = await this.runner.repositories.outbox.findUnpublished(
          this.options.batchSize,
        );
      } catch (error) {
        this.logger.error(`Could not read the outbox: ${String(error)}`);
        return { published, failed: true };
      }
      if (rows.length === 0) return { published, failed: false };

      if (!(await this.redisReady())) return { published, failed: true };
      for (const row of rows) {
        if (!(await this.publish(row))) return { published, failed: true };
        published += 1;
      }
      if (rows.length < this.options.batchSize) {
        return { published, failed: false };
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.publishPending()
        .catch((error: unknown) => {
          this.logger.error(`Outbox relay poll failed: ${String(error)}`);
        })
        .finally(() => this.schedule(this.options.pollIntervalMs));
    }, delayMs);
  }

  /**
   * Skips the poll while the connection is down, so an outage does not pile
   * up commands in the client's offline queue.
   */
  private async redisReady(): Promise<boolean> {
    try {
      const client = await this.withTimeout(this.queue.getBackend().client);
      if (client.status === 'ready') return true;
      this.logger.warn(`Redis unavailable (${client.status}); outbox waits`);
    } catch (error) {
      this.logger.warn(`Redis unavailable; outbox waits: ${String(error)}`);
    }
    return false;
  }

  private async publish(row: OutboxEvent): Promise<boolean> {
    const data: OutboxJobData = {
      outboxEventId: row.id,
      eventType: row.eventType,
      paymentId: row.paymentId,
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
    };
    try {
      await this.withTimeout(
        this.queue.add(row.eventType, data, {
          ...OUTBOX_JOB_OPTIONS,
          jobId: jobIds.outboxEvent(row.id),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not enqueue outbox row ${row.id}; it stays unpublished: ${String(error)}`,
      );
      return false;
    }
    try {
      await this.runner.repositories.outbox.markPublished(
        row.id,
        this.clock.now(),
      );
    } catch (error) {
      // The job exists; the next poll re-adds it (a no-op) and marks it.
      this.logger.error(
        `Enqueued outbox row ${row.id} but could not mark it published: ${String(error)}`,
      );
      return false;
    }
    return true;
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`timed out after ${this.options.addTimeoutMs} ms`)),
        this.options.addTimeoutMs,
      );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
}
