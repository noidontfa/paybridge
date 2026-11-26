import type { ReadScope } from '../../../payment-core/port/organization-scope.js';
import type { WebhookDeliveryStatus } from '../entities/webhook-delivery.js';
import type { Actor } from '../entities/webhook-endpoint.js';

export interface WebhookDeliveryFilters {
  readonly endpointId?: string;
  readonly status?: WebhookDeliveryStatus;
  readonly kind?: string;
  readonly paymentId?: string;
}

export interface WebhookDeliveryListQuery {
  readonly limit: number;
  /** The last row already shown (keyset paging, newest first). */
  readonly after?: { readonly value: string; readonly id: string };
  readonly filters: WebhookDeliveryFilters;
}

/** A delivery as the Console lists it. */
export interface WebhookDeliveryListRow {
  readonly id: string;
  readonly endpoint: { readonly id: string; readonly url: string };
  readonly eventId: string;
  readonly eventKind: string;
  readonly paymentId: string | null;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt: Date | null;
  readonly lastHttpStatus: number | null;
  readonly createdAt: Date;
}

export interface WebhookDeliveryAttemptRow {
  readonly id: string;
  readonly attemptedAt: Date;
  readonly succeeded: boolean;
  readonly httpStatus: number | null;
  readonly durationMs: number;
  readonly responseBody: string | null;
  readonly error: string | null;
  /** Who resent or test-sent it; null for an automatic attempt. */
  readonly triggeredBy: Actor | null;
}

export interface WebhookDeliveryDetailRow extends WebhookDeliveryListRow {
  readonly eventCreatedAt: Date;
  /** Newest first. */
  readonly history: readonly WebhookDeliveryAttemptRow[];
}

/**
 * Read model behind the Console's delivery pages and the endpoint health
 * mark. Scope first (ADR 0006): a Super Admin may read every Organization.
 */
export abstract class WebhookDeliveriesReadRepository {
  /** Up to `limit + 1` rows, newest first, so the caller can tell whether another page exists. */
  abstract list(
    scope: ReadScope,
    query: WebhookDeliveryListQuery,
  ): Promise<WebhookDeliveryListRow[]>;

  abstract findById(
    scope: ReadScope,
    id: string,
  ): Promise<WebhookDeliveryDetailRow | null>;

  /**
   * The outcomes of each endpoint's latest `count` attempts, newest first
   * (true = succeeded), by endpoint id.
   */
  abstract latestOutcomes(
    scope: ReadScope,
    endpointIds: readonly string[],
    count: number,
  ): Promise<Map<string, boolean[]>>;
}
