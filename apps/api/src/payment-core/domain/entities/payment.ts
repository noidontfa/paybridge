import type { PaymentTransaction } from './payment-transaction.js';
import type { PaymentStatus } from '../statuses.js';

/**
 * The Payment aggregate root, loaded with its attempts (oldest first).
 * Refunds are not loaded in Phase 1.
 */
export interface Payment {
  readonly id: string;
  /** The Organization this Payment belongs to; set once. */
  readonly organizationId: string;
  /** Upstream Reference: unique within the Organization, immutable. */
  readonly merchantOrderId: string;
  /** Decimal string in the currency's major unit (VND: whole dong). */
  readonly amount: string;
  /** ISO 4217 code. */
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set when the Embedded Checkout created the Payment; null otherwise. */
  readonly checkoutOrigin: CheckoutOrigin | null;
  readonly attempts: readonly PaymentTransaction[];
}

/**
 * Where a checkout Payment came from: the Pricing Plan (its name copied at
 * that moment, so a later rename changes nothing) and the Customer Reference,
 * an opaque id, an email or both. Payment Core stores and reports it; the
 * checkout module decides what it means.
 */
export interface CheckoutOrigin {
  readonly pricingPlanId: string;
  readonly pricingPlanName: string;
  readonly customerReference: string | null;
  readonly customerEmail: string | null;
}

/**
 * The checkout origin as Payment Events carry it: `{ checkoutOrigin }` for a
 * checkout Payment, nothing for any other, so API Payments' payloads keep
 * their shape. Spread it into every Payment Event payload.
 */
export function checkoutOriginPayload(
  payment: Pick<Payment, 'checkoutOrigin'>,
): { checkoutOrigin?: CheckoutOrigin } {
  return payment.checkoutOrigin
    ? { checkoutOrigin: { ...payment.checkoutOrigin } }
    : {};
}

/** What a use case supplies to insert a Payment. */
export interface NewPayment {
  readonly id: string;
  readonly merchantOrderId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly checkoutOrigin?: CheckoutOrigin;
}

/** The mutable fields of a Payment. Amount and upstream reference never change. */
export interface PaymentChanges {
  readonly status?: PaymentStatus;
}
