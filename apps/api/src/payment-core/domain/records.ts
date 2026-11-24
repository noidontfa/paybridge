// Records of Core's infrastructure tables (outbox, webhook inbox, idempotency
// keys, raw gateway responses, status transitions), as plain objects. The
// repositories return these; they carry no ORM type.

// --- Status transitions (append-only audit trail) --------------------------

export type StatusTransitionEntityType =
  'PAYMENT' | 'PAYMENT_TRANSACTION' | 'REFUND';

export interface NewStatusTransition {
  readonly entityType: StatusTransitionEntityType;
  readonly entityId: string;
  /** Null when the entity is created. */
  readonly fromStatus: string | null;
  readonly toStatus: string;
  /** What caused it, e.g. `merchant_cancel`, `webhook`, `expiry_sweep`. */
  readonly trigger: string;
  /** Who caused it, e.g. `merchant`, `system`, an operator id. */
  readonly actor: string;
  readonly reason?: string | null;
}

export interface StatusTransition extends NewStatusTransition {
  readonly id: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

// --- Outbox -----------------------------------------------------------------

export type OutboxEventType =
  | 'PaymentCreated'
  | 'PaymentSucceeded'
  | 'PaymentCancelled'
  | 'PaymentExpired'
  | 'PaymentRequiresReview';

export interface NewOutboxEvent {
  /** Generated with `newId()` when omitted. Also the BullMQ job id. */
  readonly id?: string;
  readonly eventType: OutboxEventType;
  readonly paymentId: string;
  readonly payload: unknown;
}

export interface OutboxEvent {
  readonly id: string;
  readonly eventType: OutboxEventType;
  readonly paymentId: string;
  readonly payload: unknown;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

// --- Webhook inbox ----------------------------------------------------------

export type WebhookInboxStatus =
  'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface NewWebhookInboxEntry {
  /** Generated with `newId()` when omitted. */
  readonly id?: string;
  readonly gatewayId: string;
  /** Provider event id when present, otherwise SHA-256 of the raw body. */
  readonly dedupeKey: string;
  readonly providerEventId?: string | null;
  readonly attemptKey?: string | null;
  readonly rawBody: Uint8Array;
  /** Allow-listed per plugin. */
  readonly headers: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
}

export interface WebhookInboxEntry {
  readonly id: string;
  readonly gatewayId: string;
  readonly dedupeKey: string;
  readonly providerEventId: string | null;
  readonly attemptKey: string | null;
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly status: WebhookInboxStatus;
  readonly attempts: number;
  readonly lockedAt: Date | null;
  readonly lastError: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

// --- Idempotency keys -------------------------------------------------------

export interface NewIdempotencyRecord {
  readonly key: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly paymentId: string | null;
  readonly expiresAt: Date;
  /** Default: the database clock. Pass the injected Clock's time. */
  readonly createdAt?: Date;
}

export interface IdempotencyRecord extends Omit<
  NewIdempotencyRecord,
  'createdAt'
> {
  readonly createdAt: Date;
}

// --- Raw gateway responses --------------------------------------------------

export type GatewayOperation = 'initiate' | 'query' | 'cancel';

export interface NewGatewayRawResponse {
  readonly attemptId: string;
  readonly operation: GatewayOperation;
  /** The provider's original response, never interpreted by Core. */
  readonly payload: unknown;
}

export interface GatewayRawResponse extends NewGatewayRawResponse {
  readonly id: string;
  readonly createdAt: Date;
}
