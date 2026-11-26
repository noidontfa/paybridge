import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';

/**
 * Who a checkout Payment is for, as resuming compares it: the browser session
 * (the SHA-256 of its token), the Pricing Plan and the Customer Reference.
 * A missing Customer Reference or email is the empty string.
 */
export interface CheckoutSessionKey {
  readonly sessionTokenHash: string;
  readonly pricingPlanId: string;
  readonly customerReference: string;
  readonly customerEmail: string;
}

/** One Payment the Embedded Checkout started. */
export interface CheckoutSession extends CheckoutSessionKey {
  readonly id: string;
  readonly publishableKeyId: string;
  readonly paymentId: string;
  readonly createdAt: Date;
}

/**
 * Persistence port for checkout sessions. Every method takes the Organization
 * scope first (ADR 0006).
 */
export abstract class CheckoutSessionRepository {
  abstract create(
    scope: OrganizationScope,
    session: CheckoutSession,
  ): Promise<void>;

  /** The most recent Payment started for the same key, if any. */
  abstract latest(
    scope: OrganizationScope,
    key: CheckoutSessionKey,
  ): Promise<CheckoutSession | null>;

  /** Null when the Payment was not started by the Organization's checkout. */
  abstract findByPaymentId(
    scope: OrganizationScope,
    paymentId: string,
  ): Promise<CheckoutSession | null>;
}
