import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type {
  DeliveryAttemptResult,
  NewWebhookDelivery,
} from '../entities/webhook-delivery.js';
import type { Actor } from '../entities/webhook-endpoint.js';

/**
 * Attempts a User asked for: resends and test sends. Each records who asked
 * (the webhooks audit log). Scope first (ADR 0006).
 */
export abstract class ManualAttemptRepository {
  /**
   * Records a resend of an existing delivery. A success delivers it (and
   * cancels any retry still due); a failure leaves its status and retry
   * schedule as they were, so an earlier success stays visible and automatic
   * retries go on. A resend is its own attempt, sent at once: it does not
   * claim the delivery. False when the Organization has no such delivery.
   */
  abstract recordResend(
    scope: OrganizationScope,
    deliveryId: string,
    attemptId: string,
    result: DeliveryAttemptResult,
    actor: Actor,
  ): Promise<boolean>;

  /** Stores a test delivery with its only attempt; it is never retried. */
  abstract recordTestSend(
    scope: OrganizationScope,
    delivery: NewWebhookDelivery,
    attemptId: string,
    result: DeliveryAttemptResult,
    actor: Actor,
  ): Promise<void>;
}
