import type { PaymentTransaction } from './payment-transaction.js';
import type { PaymentStatus } from './statuses.js';

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
  readonly attempts: readonly PaymentTransaction[];
}

/** What a use case supplies to insert a Payment. */
export interface NewPayment {
  readonly id: string;
  readonly merchantOrderId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
}

/** The mutable fields of a Payment. Amount and upstream reference never change. */
export interface PaymentChanges {
  readonly status?: PaymentStatus;
}
