import { ALL_ORGANIZATIONS } from '../../domain/value-objects/organization-scope.js';
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../domain/services/clock.js';
import {
  JobDispatcher,
  type JobOptions,
} from '../../domain/services/job-dispatcher.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';

/** Job name of one Payment to expire, on the payment-expiry queue. */
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
export function expirePaymentJobOptions(): JobOptions {
  return {
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
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
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
    await this.dispatcher.enqueueMany(
      'paymentExpiry',
      ids.map((paymentId) => ({
        name: EXPIRE_PAYMENT_JOB,
        jobId: paymentId,
        data: { paymentId } satisfies ExpirePaymentJobData,
        options: expirePaymentJobOptions(),
      })),
    );
    return { queued: ids.length };
  }
}
