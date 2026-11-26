import type { SealedValue } from '../services/credential-cipher.js';
import type { GatewayConnection } from '../entities/gateway-connection.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../value-objects/organization-scope.js';
import type {
  NewPayment,
  Payment,
  PaymentChanges,
} from '../entities/payment.js';
import type {
  NewPaymentTransaction,
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../entities/payment-transaction.js';
import type {
  GatewayRawResponse,
  IdempotencyRecord,
  NewGatewayRawResponse,
  NewIdempotencyRecord,
  NewOutboxEvent,
  NewStatusTransition,
  NewWebhookInboxEntry,
  OutboxEvent,
  StatusTransition,
  StatusTransitionEntityType,
  WebhookInboxEntry,
} from '../records.js';
import type { ReviewReason } from '../statuses.js';

/**
 * A write broke a unique constraint: someone else inserted the same row
 * first. A repository throws it from the writes that can lose such a race, so
 * a use case can tell that apart from a real failure. A transaction it was
 * thrown in is already rolled back; recover outside it.
 */
export class UniqueViolationError extends Error {
  override readonly name = 'UniqueViolationError';
}

/**
 * The Payment aggregate: a Payment plus its attempts. No Refunds in Phase 1.
 * Every method takes the Organization scope first (ADR 0006): a Payment of
 * another Organization is simply not found.
 */
export interface PaymentRepository {
  findById(scope: ReadScope, id: string): Promise<Payment | null>;

  /**
   * Locks the Payment row until the surrounding transaction ends, then loads
   * the aggregate. Every use case that changes a Payment or its attempts calls
   * this first. Only valid inside `TransactionRunner.run`.
   */
  findForUpdate(scope: ReadScope, id: string): Promise<Payment | null>;

  /** Throws `UniqueViolationError` when the Organization already has this Upstream Reference. */
  create(scope: OrganizationScope, payment: NewPayment): Promise<Payment>;

  update(
    scope: ReadScope,
    id: string,
    changes: PaymentChanges,
  ): Promise<Payment>;

  /** Throws `UniqueViolationError` when the Payment already has an open attempt. */
  createAttempt(
    scope: OrganizationScope,
    attempt: NewPaymentTransaction,
  ): Promise<PaymentTransaction>;

  updateAttempt(
    scope: ReadScope,
    id: string,
    changes: PaymentTransactionChanges,
  ): Promise<PaymentTransaction>;

  /**
   * Ids of `PENDING` Payments whose deadline is at or before `now`, earliest
   * deadline first, at most `limit`. Payments with an attempt in
   * `REQUIRES_REVIEW` are left out.
   */
  findExpiredPendingIds(
    scope: ReadScope,
    now: Date,
    limit: number,
  ): Promise<string[]>;

  /**
   * Ids of attempts in `REQUIRES_REVIEW` for one of `reasons` whose review
   * opened after `openedAfter`, oldest review first.
   */
  findReviewRequeryAttemptIds(
    scope: ReadScope,
    reasons: readonly ReviewReason[],
    openedAfter: Date,
    limit: number,
  ): Promise<string[]>;

  /** The id of the Payment an attempt belongs to, if the attempt exists. */
  findPaymentIdByAttemptId(
    scope: ReadScope,
    attemptId: string,
  ): Promise<string | null>;

  /** The id of the Organization's Payment with this Upstream Reference, if any. */
  findIdByUpstreamReference(
    scope: OrganizationScope,
    merchantOrderId: string,
  ): Promise<string | null>;

  /** True once the Embedded Checkout created a Payment for the Pricing Plan. */
  anyForPricingPlan(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<boolean>;
}

/**
 * Transactional outbox of Payment-level events. Write it with the runner's
 * transaction-bound repositories so the event exists if and only if the state
 * change committed. The row id is also the job id.
 */
export interface OutboxRepository {
  add(scope: OrganizationScope, event: NewOutboxEvent): Promise<OutboxEvent>;

  /** Every event of one Payment, oldest first. */
  listForPayment(scope: ReadScope, paymentId: string): Promise<OutboxEvent[]>;

  /** The oldest unpublished rows, at most `limit`. */
  findUnpublished(scope: ReadScope, limit: number): Promise<OutboxEvent[]>;

  /**
   * Sets the published time once. A row another relay instance already
   * marked keeps its time. Never deletes (retention does that).
   */
  markPublished(scope: ReadScope, id: string, publishedAt: Date): Promise<void>;

  /**
   * Retention: deletes rows published at or before `cutoff`. Unpublished rows
   * never match, so pending work is never lost.
   */
  deletePublishedBefore(scope: ReadScope, cutoff: Date): Promise<number>;
}

export interface RecordedWebhook {
  readonly entry: WebhookInboxEntry;
  /** True when a row with the same gateway and dedupe key already existed. */
  readonly duplicate: boolean;
}

/** Verified gateway callbacks, stored before processing. */
export interface WebhookInboxRepository {
  /**
   * Stores the callback as `RECEIVED` unless one with the same gateway and
   * dedupe key exists. It never aborts the surrounding transaction. Returns
   * the stored row either way.
   */
  record(
    scope: OrganizationScope,
    callback: NewWebhookInboxEntry,
  ): Promise<RecordedWebhook>;

  findById(scope: ReadScope, id: string): Promise<WebhookInboxEntry | null>;

  /**
   * Claims a `RECEIVED` or `FAILED` row for processing: sets `PROCESSING`,
   * the lock time, and counts one more processing try in `attempts`. Returns
   * null when the row is missing, already `PROCESSED`, or being processed, so
   * a duplicate job does nothing.
   */
  claim(
    scope: ReadScope,
    id: string,
    now: Date,
  ): Promise<WebhookInboxEntry | null>;

  /** Marks a row done. Use the transaction that applied its change. */
  markProcessed(scope: ReadScope, id: string, now: Date): Promise<void>;

  /** Marks a row failed with the error, for the inbox sweep to retry. */
  markFailed(scope: ReadScope, id: string, error: string): Promise<void>;

  /**
   * Inbox sweep: resets `PROCESSING` rows locked before `cutoff` (the worker
   * died) to `RECEIVED` and clears the lock. Returns the number of rows reset.
   */
  resetStaleProcessing(scope: ReadScope, cutoff: Date): Promise<number>;

  /**
   * Inbox sweep: ids of rows to dispatch, oldest first, at most `limit`: every
   * `RECEIVED` row, and `FAILED` rows tried at most `maxAttempts` times.
   */
  findDispatchableIds(
    scope: ReadScope,
    maxAttempts: number,
    limit: number,
  ): Promise<string[]>;

  /** `FAILED` rows tried more than `maxAttempts` times: left for manual handling. */
  findExhausted(
    scope: ReadScope,
    maxAttempts: number,
    limit: number,
  ): Promise<WebhookInboxEntry[]>;

  /**
   * Retention: deletes rows received at or before `cutoff`, except `FAILED`
   * rows, which are never deleted automatically.
   */
  deleteReceivedBefore(scope: ReadScope, cutoff: Date): Promise<number>;
}

/** Idempotency-Key records for `POST /payments` (kept 24 hours). */
export interface IdempotencyKeyRepository {
  /** Throws `UniqueViolationError` when the Organization already has this key. */
  create(
    scope: OrganizationScope,
    record: NewIdempotencyRecord,
  ): Promise<IdempotencyRecord>;

  find(
    scope: OrganizationScope,
    key: string,
  ): Promise<IdempotencyRecord | null>;

  /** Deletes the record for `key` if it expired at or before `now`. */
  deleteIfExpired(
    scope: OrganizationScope,
    key: string,
    now: Date,
  ): Promise<void>;

  /** Retention: deletes every record that expired at or before `cutoff`. */
  deleteExpiredBefore(scope: ReadScope, cutoff: Date): Promise<number>;
}

export interface NewGatewayConnection {
  readonly id: string;
  readonly gatewayId: string;
  readonly credentialsCiphertext: string | null;
  readonly credentialsKeyId: string | null;
  readonly enabled?: boolean;
}

/** Gateway Connections: one per Organization per gateway. */
export interface GatewayConnectionRepository {
  list(scope: ReadScope): Promise<GatewayConnection[]>;

  findById(scope: ReadScope, id: string): Promise<GatewayConnection | null>;

  findByGateway(
    scope: OrganizationScope,
    gatewayId: string,
  ): Promise<GatewayConnection | null>;

  /** Throws `UniqueViolationError` when the Organization already has a connection for the gateway. */
  create(
    scope: OrganizationScope,
    connection: NewGatewayConnection,
  ): Promise<GatewayConnection>;

  /** New credentials: bumps the version so cached plugin instances are replaced. */
  replaceCredentials(
    scope: OrganizationScope,
    id: string,
    sealed: SealedValue,
  ): Promise<GatewayConnection>;

  /** Same credentials under another key (rotation): the version stays. */
  recrypt(
    scope: OrganizationScope,
    id: string,
    sealed: SealedValue,
  ): Promise<GatewayConnection>;

  setEnabled(
    scope: OrganizationScope,
    id: string,
    enabled: boolean,
  ): Promise<GatewayConnection>;

  delete(scope: OrganizationScope, id: string): Promise<void>;

  /** True once any attempt of the Organization used the gateway. */
  isUsed(scope: OrganizationScope, gatewayId: string): Promise<boolean>;
}

/** Raw provider payloads, stored for audit and never interpreted. */
export interface GatewayRawResponseRepository {
  record(
    scope: OrganizationScope,
    response: NewGatewayRawResponse,
  ): Promise<GatewayRawResponse>;

  /** Every stored response of one attempt, oldest first. */
  listForAttempt(
    scope: ReadScope,
    attemptId: string,
  ): Promise<GatewayRawResponse[]>;
}

/**
 * Append-only audit trail of status changes. Write it with the runner's
 * transaction-bound repositories so it commits or rolls back with the change.
 */
export interface StatusTransitionRepository {
  record(
    scope: OrganizationScope,
    transition: NewStatusTransition,
  ): Promise<StatusTransition>;

  /** The trail of one entity, oldest first. */
  listForEntity(
    scope: ReadScope,
    entityType: StatusTransitionEntityType,
    entityId: string,
  ): Promise<StatusTransition[]>;
}

/**
 * Every repository, bound to one database handle. The transaction runner
 * hands a transaction-bound set to its callback. There is no Refund
 * repository in Phase 1. Add new repositories here.
 */
export interface Repositories {
  readonly payments: PaymentRepository;
  readonly outbox: OutboxRepository;
  readonly webhookInbox: WebhookInboxRepository;
  readonly idempotencyKeys: IdempotencyKeyRepository;
  readonly gatewayConnections: GatewayConnectionRepository;
  readonly gatewayRawResponses: GatewayRawResponseRepository;
  readonly statusTransitions: StatusTransitionRepository;
}
