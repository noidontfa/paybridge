import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
} from '../../../payment-core/port/organization-scope.js';
import { refused, AttemptDelivery } from '../attempt-delivery.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { retryDelayMs } from '../../domain/services/backoff.js';
import {
  DeliveryDispatcher,
  newWebhookId,
  RetryJitter,
  WebhooksClock,
} from '../../domain/services/ports.js';

/**
 * A worker holding a delivery longer than this is taken to be gone, and the
 * delivery may be claimed again. Far above one attempt's timeout (~10 s).
 */
export const WEBHOOK_DELIVERY_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export type DeliverWebhookResult =
  | 'succeeded'
  /** Failed; the next attempt is scheduled. */
  | 'retrying'
  /** Failed for good: the last attempt, or the endpoint was disabled or deleted. */
  | 'failed'
  /** Not waiting for an attempt now (done, not due, or held by a worker). */
  | 'skipped';

/**
 * Makes one attempt of a waiting delivery: claims it (so no other instance
 * sends it at the same time), signs the envelope with the endpoint's secret
 * (and the previous one while it is valid), POSTs it and records the attempt.
 * A 2xx answer delivers it. Anything else schedules the next attempt on the
 * backoff schedule, or fails the delivery after the last one. PostgreSQL holds
 * the outcome before the next job is queued, so if Redis is down then, the
 * delivery sweep queues it later.
 */
@Injectable()
export class DeliverWebhook {
  private readonly logger = new Logger(DeliverWebhook.name);

  constructor(
    @Inject(TransactionRunner)
    private readonly runner: TransactionRunner,
    @Inject(AttemptDelivery) private readonly attempt: AttemptDelivery,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
    @Inject(DeliveryDispatcher) private readonly dispatcher: DeliveryDispatcher,
    @Inject(RetryJitter) private readonly jitter: RetryJitter,
  ) {}

  async execute(deliveryId: string): Promise<DeliverWebhookResult> {
    const now = this.clock.now();
    const repos = this.runner.repositories;
    // The job carries only the delivery id; the row names its Organization.
    const delivery = await repos.deliveries.claim(
      ALL_ORGANIZATIONS,
      deliveryId,
      now,
      new Date(now.getTime() - WEBHOOK_DELIVERY_LOCK_TIMEOUT_MS),
    );
    if (!delivery) return 'skipped';
    const scope = organizationScope(delivery.organizationId);
    const endpoint = await repos.endpoints.findById(scope, delivery.endpointId);

    const attemptedAt = this.clock.now();
    const result =
      endpoint && endpoint.status === 'ENABLED'
        ? await this.attempt.post(delivery, endpoint, attemptedAt)
        : refused(
            attemptedAt,
            endpoint
              ? 'The Webhook Endpoint is disabled'
              : 'The Webhook Endpoint was deleted',
          );

    // Disabling an endpoint stops its deliveries, like deleting it: no POST,
    // no retry. A User may still resend one by hand.
    const attempt = delivery.attempts + 1;
    const delay =
      result.succeeded || !endpoint || endpoint.status !== 'ENABLED'
        ? null
        : retryDelayMs(attempt, this.jitter.next());
    const nextAttemptAt =
      delay === null ? null : new Date(attemptedAt.getTime() + delay);
    await this.runner.run((tx) =>
      tx.deliveries.recordAttempt(
        scope,
        delivery.id,
        newWebhookId(),
        result,
        nextAttemptAt,
      ),
    );
    if (result.succeeded) return 'succeeded';
    if (!nextAttemptAt) return 'failed';
    try {
      await this.dispatcher.schedule(
        { deliveryId: delivery.id, attempt: attempt + 1 },
        nextAttemptAt,
      );
    } catch (error) {
      // The row says when it is due; the delivery sweep queues it then.
      this.logger.warn(
        `Could not queue attempt ${attempt + 1} of delivery ${delivery.id}: ${(error as Error).message}`,
      );
    }
    return 'retrying';
  }
}
