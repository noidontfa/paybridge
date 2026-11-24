import type { NextAction, ProviderMetadata } from '../port/index.js';
import type { AttemptStatus, ReviewReason } from './statuses.js';

/**
 * One attempt to collect a Payment through one gateway. `id` is the Attempt
 * Key. It has no amount of its own in Phase 1.
 */
export interface PaymentTransaction {
  readonly id: string;
  readonly paymentId: string;
  readonly gatewayId: string;
  readonly status: AttemptStatus;
  readonly providerRef: string | null;
  readonly providerMetadata: ProviderMetadata | null;
  readonly nextAction: NextAction | null;
  readonly reviewReason: ReviewReason | null;
  readonly reviewOpenedAt: Date | null;
  readonly refundRequired: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What a use case supplies to insert an attempt. */
export interface NewPaymentTransaction {
  readonly id: string;
  readonly paymentId: string;
  readonly gatewayId: string;
  readonly status: AttemptStatus;
  readonly providerRef?: string | null;
  readonly providerMetadata?: ProviderMetadata | null;
  readonly nextAction?: NextAction | null;
}

/** The mutable fields of an attempt. Id, payment and gateway never change. */
export interface PaymentTransactionChanges {
  readonly status?: AttemptStatus;
  readonly providerRef?: string | null;
  readonly providerMetadata?: ProviderMetadata | null;
  readonly nextAction?: NextAction | null;
  readonly reviewReason?: ReviewReason | null;
  readonly reviewOpenedAt?: Date | null;
  readonly refundRequired?: boolean;
}
