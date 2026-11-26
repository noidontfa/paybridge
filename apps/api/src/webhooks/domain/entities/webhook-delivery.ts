export type WebhookDeliveryStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/**
 * One Payment Event to one Webhook Endpoint. `eventId` is the outbox event id,
 * the same on every attempt; `data` is the Payment Event payload as Core
 * wrote it.
 */
export interface WebhookDelivery {
  readonly id: string;
  readonly organizationId: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventKind: string;
  readonly eventCreatedAt: Date;
  readonly paymentId: string | null;
  readonly data: unknown;
  readonly status: WebhookDeliveryStatus;
  /** Attempts made so far. */
  readonly attempts: number;
  /** When a `PENDING` delivery is due for its next attempt (null: now). */
  readonly nextAttemptAt: Date | null;
}

export interface NewWebhookDelivery {
  readonly id: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventKind: string;
  readonly eventCreatedAt: Date;
  readonly paymentId: string | null;
  readonly data: unknown;
}

/** What one HTTP POST of a delivery came to. */
export interface DeliveryAttemptResult {
  readonly attemptedAt: Date;
  readonly succeeded: boolean;
  /** Null when no HTTP answer came (refused address, timeout, network error). */
  readonly httpStatus: number | null;
  readonly durationMs: number;
  /** The start of the response body, truncated. */
  readonly responseBody: string | null;
  /** Why the attempt failed, when it did. */
  readonly error: string | null;
}

/** The JSON body every Webhook carries. */
export interface WebhookEnvelope {
  /** The Payment Event id, stable across attempts and resends. */
  readonly id: string;
  readonly type: string;
  /** ISO 8601 time the Payment Event happened. */
  readonly createdAt: string;
  readonly organizationId: string;
  readonly data: unknown;
}

export function envelopeOf(delivery: WebhookDelivery): WebhookEnvelope {
  return {
    id: delivery.eventId,
    type: delivery.eventKind,
    createdAt: delivery.eventCreatedAt.toISOString(),
    organizationId: delivery.organizationId,
    data: delivery.data,
  };
}
