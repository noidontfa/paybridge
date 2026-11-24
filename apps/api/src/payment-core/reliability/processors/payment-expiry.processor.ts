import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  ExpirePayment,
  type ExpirePaymentResult,
} from '../../application/workers/expire-payment.js';
import { QUEUES } from '../../infrastructure/queue/queue.constants.js';
import {
  EXPIRE_PAYMENT_JOB,
  type ExpirePaymentJobData,
} from '../expiry-sweep.js';

/**
 * Worker of the expiry queue: runs `ExpirePayment` for each Payment the sweep
 * queued. Concurrency 1 (BullMQ default); ticket 24 adds the provider-query
 * rate limit for Payments with attempts.
 */
@Processor(QUEUES.paymentExpiry)
export class PaymentExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentExpiryProcessor.name);

  constructor(
    @Inject(ExpirePayment) private readonly expirePayment: ExpirePayment,
  ) {
    super();
  }

  async process(
    job: Job<ExpirePaymentJobData>,
  ): Promise<ExpirePaymentResult | undefined> {
    if (job.name !== EXPIRE_PAYMENT_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name} (${job.id})`);
      return undefined;
    }
    return this.expirePayment.execute(job.data.paymentId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ExpirePaymentJobData> | undefined, error: Error): void {
    this.logger.error(
      `Expiry of payment ${job?.data.paymentId ?? '?'} failed (attempt ${job?.attemptsMade ?? '?'}): ${error.message}`,
    );
  }
}
