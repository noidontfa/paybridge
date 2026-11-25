import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { validate as isUuid } from 'uuid';
import { PaymentNotFoundError } from '../../domain/errors.js';
import type { OrganizationScope } from '../../domain/organization-scope.js';
import type { Payment } from '../../domain/payment.js';
import { isOpenAttempt } from '../../domain/rules/attempt-transitions.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../../infrastructure/queue/queue.constants.js';

/** BullMQ job name for one attempt status query (`RequeryAttempt` consumes it). */
export const QUERY_ATTEMPT_JOB = 'query-attempt';

/** Rebuildable from the attempt row: the attempt id is the whole payload. */
export interface QueryAttemptJobData {
  readonly attemptId: string;
}

/**
 * Removed when finished so a later return can queue the query again under the
 * same job id; a failed query is retried a few times with backoff.
 */
export const QUERY_ATTEMPT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export interface BrowserReturnInput {
  readonly paymentId: string;
  /** The attempt the customer paid with; default: the Payment's open attempt. */
  readonly attemptId?: string;
}

/**
 * The customer's browser came back from the gateway (spec: Use cases,
 * `handleBrowserReturn`). Writes nothing to PostgreSQL and never moves an
 * attempt: it only queues a status query for the attempt and returns the
 * stored Payment, which may still be `PENDING`. Nothing the provider put in
 * the return request is trusted or read.
 *
 * Queueing is best-effort: if Redis is down the page still shows the stored
 * state, and the webhook or the expiry sweep settles the attempt.
 */
@Injectable()
export class HandleBrowserReturn {
  private readonly logger = new Logger(HandleBrowserReturn.name);

  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @InjectQueue(QUEUES.attemptStatusQuery) private readonly queue: Queue,
  ) {}

  async execute(
    scope: OrganizationScope,
    input: BrowserReturnInput,
  ): Promise<Payment> {
    const payment = isUuid(input.paymentId)
      ? await this.runner.repositories.payments.findById(scope, input.paymentId)
      : null;
    if (!payment) throw new PaymentNotFoundError(input.paymentId);

    const wanted = input.attemptId?.toLowerCase();
    const attempt = wanted
      ? payment.attempts.find((a) => a.id === wanted)
      : payment.attempts.find((a) => isOpenAttempt(a.status));
    if (attempt && isOpenAttempt(attempt.status)) {
      const data: QueryAttemptJobData = { attemptId: attempt.id };
      try {
        await this.queue.add(QUERY_ATTEMPT_JOB, data, {
          jobId: jobIds.attempt(attempt.id),
          ...QUERY_ATTEMPT_JOB_OPTIONS,
        });
      } catch (error) {
        this.logger.error(
          `Could not queue status query for attempt ${attempt.id}: ${String(error)}`,
        );
      }
    }
    return payment;
  }
}
