import { Inject, Injectable } from '@nestjs/common';
import { ALL_ORGANIZATIONS } from '../../../payment-core/port/organization-scope.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import {
  DeliveryDispatcher,
  WebhooksClock,
} from '../../domain/services/ports.js';
import { WEBHOOK_DELIVERY_LOCK_TIMEOUT_MS } from '../workers/deliver-webhook.js';

/** Deliveries handed over per run; the next run takes the rest. */
export const WEBHOOK_DELIVERY_SWEEP_BATCH_SIZE = 500;

export interface WebhookDeliverySweepResult {
  readonly dispatched: number;
}

/**
 * Webhook delivery sweep (spec: Webhook Endpoint and delivery, Retries).
 * PostgreSQL is the source of truth (ADR 0002): every `PENDING` delivery that
 * is due and not held by a live worker is handed to the delivery queue again,
 * under the job id of its next attempt. That recovers attempts whose job was
 * lost from Redis, never queued (Redis was down), or left by a worker that
 * died. Runs every minute from the `wh-delivery-sweep` job scheduler.
 *
 * Handing over an attempt that is already queued is harmless: the worker's
 * claim lets one instance in, and only while the delivery is due.
 */
@Injectable()
export class WebhookDeliverySweep {
  constructor(
    @Inject(TransactionRunner)
    private readonly runner: TransactionRunner,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
    @Inject(DeliveryDispatcher) private readonly dispatcher: DeliveryDispatcher,
  ) {}

  async run(): Promise<WebhookDeliverySweepResult> {
    const now = this.clock.now();
    const due = await this.runner.repositories.deliveries.findDue(
      ALL_ORGANIZATIONS,
      now,
      new Date(now.getTime() - WEBHOOK_DELIVERY_LOCK_TIMEOUT_MS),
      WEBHOOK_DELIVERY_SWEEP_BATCH_SIZE,
    );
    await this.dispatcher.redispatch(
      due.map((d) => ({ deliveryId: d.id, attempt: d.attempts + 1 })),
    );
    return { dispatched: due.length };
  }
}
