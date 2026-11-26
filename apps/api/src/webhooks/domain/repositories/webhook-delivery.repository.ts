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

  /** Records one attempt and moves the delivery to its outcome. */
  abstract recordAttempt(
    scope: OrganizationScope,
    deliveryId: string,
    attemptId: string,
    result: DeliveryAttemptResult,
  ): Promise<void>;
}
