import type {
  OrganizationScope,
  ReadScope,
} from '../../../payment-core/port/organization-scope.js';
import type {
  DeliveryAttemptResult,
  NewWebhookDelivery,
  WebhookDelivery,
} from '../entities/webhook-delivery.js';

/** Persistence port for deliveries and their attempts (scope first, ADR 0006). */
export abstract class WebhookDeliveryRepository {
  /**
   * Creates the deliveries that do not exist yet. One delivery per (event,
   * endpoint): the existing ones are left alone, so this is idempotent.
   */
  abstract createMissing(
    scope: OrganizationScope,
    deliveries: readonly NewWebhookDelivery[],
  ): Promise<void>;

  /** Ids of the event's deliveries that still wait for an attempt. */
  abstract pendingIdsOfEvent(
    scope: OrganizationScope,
    eventId: string,
  ): Promise<string[]>;

  /** A worker holds only the delivery id, so it may read across Organizations. */
  abstract findById(
    scope: ReadScope,
    id: string,
  ): Promise<WebhookDelivery | null>;

  /**
   * Takes a `PENDING` delivery that is due at `now` for one attempt, unless a
   * worker holds it since `staleBefore` or later. Null when it is not there,
   * not waiting, not due or held: only one worker gets it at a time.
   */
  abstract claim(
    scope: ReadScope,
    id: string,
    now: Date,
    staleBefore: Date,
  ): Promise<WebhookDelivery | null>;

  /**
   * Records one attempt and releases the delivery: succeeded, failed for
   * good, or `PENDING` again until `nextAttemptAt`.
   */
  abstract recordAttempt(
    scope: OrganizationScope,
    deliveryId: string,
    attemptId: string,
    result: DeliveryAttemptResult,
    nextAttemptAt: Date | null,
  ): Promise<void>;

  /**
   * `PENDING` deliveries due at `now` that no worker holds (or whose holder
   * took them before `staleBefore`), oldest due first.
   */
  abstract findDue(
    scope: ReadScope,
    now: Date,
    staleBefore: Date,
    limit: number,
  ): Promise<{ id: string; attempts: number }[]>;

  /**
   * Deletes finished (succeeded or failed) deliveries created before
   * `before`, with their attempts. Returns how many deliveries went.
   */
  abstract deleteFinishedBefore(scope: ReadScope, before: Date): Promise<number>;
}
