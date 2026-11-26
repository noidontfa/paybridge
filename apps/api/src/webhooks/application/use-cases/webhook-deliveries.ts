import { Inject, Injectable } from '@nestjs/common';
import {
  isIsoTime,
  keysetCursor,
  type Page,
} from '../../../payment-core/port/console-lists.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../../payment-core/port/organization-scope.js';
import {
  TEST_EVENT_KIND,
  testEventData,
} from '../../domain/entities/test-event.js';
import type { WebhookDelivery } from '../../domain/entities/webhook-delivery.js';
import {
  WebhookEndpointNotFoundError,
  type Actor,
  type WebhookEndpoint,
} from '../../domain/entities/webhook-endpoint.js';
import { WebhooksTransactionRunner } from '../../domain/repositories/transaction-runner.js';
import {
  WebhookDeliveriesReadRepository,
  type WebhookDeliveryDetailRow,
  type WebhookDeliveryListQuery,
  type WebhookDeliveryListRow,
} from '../../domain/repositories/webhook-deliveries-read.repository.js';
import {
  FAILING_STREAK,
  isFailing,
} from '../../domain/services/endpoint-health.js';
import { newWebhookId, WebhooksClock } from '../../domain/services/ports.js';
import { AttemptDelivery, refused } from '../attempt-delivery.js';

export class WebhookDeliveryNotFoundError extends Error {
  override readonly name = 'WebhookDeliveryNotFoundError';

  constructor(readonly deliveryId: string) {
    super(`Webhook delivery ${deliveryId} not found`);
  }
}

/** The deliveries list cursor: newest first by `createdAt`. */
export const webhookDeliveriesCursor = keysetCursor<WebhookDeliveryListRow>({
  tag: 'webhook-deliveries',
  valueOf: (row) => row.createdAt.toISOString(),
  isValue: isIsoTime,
});

/**
 * The Console's view of deliveries: the list, one delivery with every
 * attempt, and which endpoints keep failing. Read only (ADR 0005).
 */
@Injectable()
export class ReadWebhookDeliveries {
  constructor(
    @Inject(WebhookDeliveriesReadRepository)
    private readonly deliveries: WebhookDeliveriesReadRepository,
  ) {}

  async list(
    scope: ReadScope,
    query: WebhookDeliveryListQuery,
  ): Promise<Page<WebhookDeliveryListRow>> {
    const rows = await this.deliveries.list(scope, query);
    return webhookDeliveriesCursor.page(rows, query.limit);
  }

  async get(scope: ReadScope, id: string): Promise<WebhookDeliveryDetailRow> {
    const delivery = await this.deliveries.findById(scope, id);
    if (!delivery) throw new WebhookDeliveryNotFoundError(id);
    return delivery;
  }

  /** The ids of the endpoints whose latest attempts all failed. */
  async failingEndpoints(
    scope: ReadScope,
    endpointIds: readonly string[],
  ): Promise<Set<string>> {
    const outcomes = await this.deliveries.latestOutcomes(
      scope,
      endpointIds,
      FAILING_STREAK,
    );
    return new Set(
      [...outcomes].filter(([, latest]) => isFailing(latest)).map(([id]) => id),
    );
  }
}

/**
 * What a User sends by hand: a resend of a delivery (Operator or Admin) and a
 * test event to one endpoint (Admin). Both go out now and record who asked.
 */
@Injectable()
export class SendWebhooksByHand {
  constructor(
    @Inject(WebhooksTransactionRunner)
    private readonly runner: WebhooksTransactionRunner,
    @Inject(AttemptDelivery) private readonly attempt: AttemptDelivery,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
  ) {}

  /**
   * A new attempt of the same delivery, with the same event id. A disabled
   * or deleted endpoint gets nothing; the attempt records why.
   */
  async resend(
    scope: OrganizationScope,
    deliveryId: string,
    actor: Actor,
  ): Promise<void> {
    const repos = this.runner.repositories;
    const delivery = await repos.deliveries.findById(scope, deliveryId);
    if (!delivery) throw new WebhookDeliveryNotFoundError(deliveryId);
    const endpoint = await repos.endpoints.findById(scope, delivery.endpointId);
    const at = this.clock.now();
    const result = !endpoint
      ? refused(at, 'The Webhook Endpoint was deleted')
      : endpoint.status === 'DISABLED'
        ? refused(at, 'The Webhook Endpoint is disabled')
        : await this.attempt.post(delivery, endpoint, at);
    const recorded = await this.runner.run((tx) =>
      tx.manualAttempts.recordResend(
        scope,
        deliveryId,
        newWebhookId(),
        result,
        actor,
      ),
    );
    if (!recorded) throw new WebhookDeliveryNotFoundError(deliveryId);
  }

  /**
   * Sends a `webhook.test` event to one endpoint, enabled or not, so a
   * receiver can be checked before it gets real Payments. Returns the test
   * delivery's id.
   */
  async sendTest(
    scope: OrganizationScope,
    endpointId: string,
    actor: Actor,
  ): Promise<string> {
    const endpoint = await this.runner.repositories.endpoints.findById(
      scope,
      endpointId,
    );
    if (!endpoint) throw new WebhookEndpointNotFoundError(endpointId);
    const at = this.clock.now();
    const delivery = testDelivery(scope, endpoint, at);
    const result = await this.attempt.post(delivery, endpoint, at);
    await this.runner.run((tx) =>
      tx.manualAttempts.recordTestSend(
        scope,
        delivery,
        newWebhookId(),
        result,
        actor,
      ),
    );
    return delivery.id;
  }
}

function testDelivery(
  scope: OrganizationScope,
  endpoint: WebhookEndpoint,
  at: Date,
): WebhookDelivery {
  return {
    id: newWebhookId(),
    organizationId: scope.organizationId,
    endpointId: endpoint.id,
    eventId: newWebhookId(),
    eventKind: TEST_EVENT_KIND,
    eventCreatedAt: at,
    paymentId: null,
    data: testEventData(endpoint.id),
    status: 'PENDING',
    attempts: 0,
    // Sent once, now; a test delivery is never retried.
    nextAttemptAt: null,
  };
}
