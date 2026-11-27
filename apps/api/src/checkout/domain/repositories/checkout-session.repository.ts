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

/**
 * Where the Customer started (the host page) and where the snippet asks to
 * send them after paying or giving up. Sent by the checkout page with an
 * attempt and read back by the return page, so the return URL a gateway
 * gets stays short. Not trusted: the return page checks every URL against
 * the Publishable Key's allowed origins before it forwards the Customer.
 */
export interface CheckoutReturnContext {
  readonly hostPageUrl: string;
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
}

/** One Payment the Embedded Checkout started. */
export interface CheckoutSession extends CheckoutSessionKey {
  readonly id: string;
  readonly publishableKeyId: string;
  readonly paymentId: string;
  readonly createdAt: Date;
  /** Null until the checkout page sends one with an attempt. */
  readonly returnContext: CheckoutReturnContext | null;
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

  /** Replaces the return context of the session that started the Payment. */
  abstract saveReturnContext(
    scope: OrganizationScope,
    paymentId: string,
    context: CheckoutReturnContext,
  ): Promise<void>;

  /** Null when the Payment was not started by the Organization's checkout. */
  abstract findByPaymentId(
    scope: OrganizationScope,
    paymentId: string,
  ): Promise<CheckoutSession | null>;
}
