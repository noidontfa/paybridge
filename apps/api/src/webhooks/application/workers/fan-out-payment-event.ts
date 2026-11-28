import { Inject, Injectable, Logger } from '@nestjs/common';
import { organizationScope } from '../../../payment-core/port/organization-scope.js';
import { eventKindOf } from '../../domain/entities/event-kinds.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import {
  DeliveryDispatcher,
  newWebhookId,
} from '../../domain/services/ports.js';

/** A Payment Event as the outbox queue carries it. */
export interface PaymentEventMessage {
  readonly eventId: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly paymentId: string | null;
  readonly createdAt: Date;
  readonly payload: unknown;
}

/**
 * Turns one Payment Event into one delivery per enabled Webhook Endpoint of
 * the event's own Organization that subscribes to its kind, then hands the
 * waiting ones to the delivery worker. Running it twice for the same event
 * creates nothing new (one delivery per event and endpoint), and re-hands
 * only deliveries still waiting, so a crash between the two steps is safe.
 */
@Injectable()
export class FanOutPaymentEvent {
  private readonly logger = new Logger(FanOutPaymentEvent.name);

  constructor(
    @Inject(TransactionRunner)
    private readonly runner: TransactionRunner,
    @Inject(DeliveryDispatcher) private readonly dispatcher: DeliveryDispatcher,
  ) {}

  async execute(event: PaymentEventMessage): Promise<{ deliveries: number }> {
    const kind = eventKindOf(event.eventType);
    if (!kind) {
      this.logger.warn(
        `No Webhook kind for event type ${event.eventType} (${event.eventId})`,
      );
      return { deliveries: 0 };
    }
    const scope = organizationScope(event.organizationId);
    const repos = this.runner.repositories;
    const endpoints = await repos.endpoints.listSubscribed(scope, kind);
    await repos.deliveries.createMissing(
      scope,
      endpoints.map((endpoint) => ({
        id: newWebhookId(),
        endpointId: endpoint.id,
        eventId: event.eventId,
        eventKind: kind,
        eventCreatedAt: event.createdAt,
        paymentId: event.paymentId,
        data: event.payload,
      })),
    );
    const pending = await repos.deliveries.pendingIdsOfEvent(
      scope,
      event.eventId,
    );
    await this.dispatcher.dispatch(pending);
    return { deliveries: pending.length };
  }
}
