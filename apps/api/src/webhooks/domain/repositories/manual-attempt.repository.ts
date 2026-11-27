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
   * Takes the delivery's lock for a resend, whatever its status, unless a
   * worker (or another resend) holds it since `staleBefore` or later. While
   * held, no automatic attempt claims it. False when the Organization has no
   * such delivery or it is held.
   */
  abstract hold(
    scope: OrganizationScope,
    deliveryId: string,
    now: Date,
    staleBefore: Date,
  ): Promise<boolean>;

  /** Gives the lock back without recording anything. */
  abstract release(scope: OrganizationScope, deliveryId: string): Promise<void>;

  /**
   * Records a resend of a delivery this caller holds, and releases it. A
   * success delivers it (and cancels any retry still due); a failure leaves
   * its status and retry schedule as they were, so an earlier success stays
   * visible and automatic retries go on. A resend does not count against the
   * automatic retries (`attempts` counts only those). False when the
   * Organization has no such delivery.
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
