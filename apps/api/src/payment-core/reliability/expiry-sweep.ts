import { ALL_ORGANIZATIONS } from '../domain/organization-scope.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { Clock } from '../domain/clock.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../infrastructure/queue/queue.constants.js';

/** Job name of one Payment to expire, on `QUEUES.paymentExpiry`. */
export const EXPIRE_PAYMENT_JOB = 'expire-payment';

export interface ExpirePaymentJobData {
  readonly paymentId: string;
}

/**
 * Options of every `expire-payment` job (the expiry queue's job defaults).
 *
 * - `jobId` = Payment id: one job per Payment, however often it is queued.
 * - `removeOnComplete` / `removeOnFail` = true: a kept job would keep its id
 *   and make the next sweep's add a no-op, so a Payment still `PENDING` after
 *   its job ended (deferred to the attempt expiry, failed, or raced) could
 *   never be queued again. Nothing is lost: the job is rebuilt from
 *   PostgreSQL by the next sweep, and the processor logs failures.
 * - `attempts` 3 with exponential backoff from 2 s (2 s, 4 s): rides out a
 *   short database hiccup within the minute. While a job waits for a retry
 *   it still holds its id, so the sweep cannot queue a parallel duplicate.
 */
export function expirePaymentJobOptions(paymentId: string): JobsOptions {
  return {
    jobId: jobIds.payment(paymentId),
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

export interface ExpirySweepOptions {
  /** Most Payments queued per run (`EXPIRY_SWEEP_BATCH_SIZE`). */
  readonly batchSize: number;
}

/** DI token of the sweep's options; built from config in PaymentCoreModule. */
export const EXPIRY_SWEEP_OPTIONS = Symbol('EXPIRY_SWEEP_OPTIONS');

/**
 * Expiry sweep (spec: Reliability, Expiry sweep). Runs every minute from the
 * `expiry-sweep` job scheduler. Reads `PENDING` Payments past their deadline
 * from PostgreSQL, earliest first and at most one batch, and queues each on
 * the expiry queue with its id as job id.
 *
 * It writes nothing to PostgreSQL, so when Redis is unavailable no state
 * changes and the next run finds the same Payments (ADR 0002).
 */
@Injectable()
export class ExpirySweep {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @InjectQueue(QUEUES.paymentExpiry) private readonly queue: Queue,
    @Inject(EXPIRY_SWEEP_OPTIONS) private readonly options: ExpirySweepOptions,
  ) {}

  async run(): Promise<{ queued: number }> {
    // A system sweep: it queues work for every Organization.
    const ids = await this.runner.repositories.payments.findExpiredPendingIds(
      ALL_ORGANIZATIONS,
      this.clock.now(),
      this.options.batchSize,
    );
    if (ids.length === 0) return { queued: 0 };
    await this.queue.addBulk(
      ids.map((paymentId) => ({
        name: EXPIRE_PAYMENT_JOB,
        data: { paymentId } satisfies ExpirePaymentJobData,
        opts: expirePaymentJobOptions(paymentId),
      })),
    );
    return { queued: ids.length };
  }
}
