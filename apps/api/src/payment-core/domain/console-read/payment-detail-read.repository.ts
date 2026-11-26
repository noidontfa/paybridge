import type { ReadScope } from '../organization-scope.js';
import type { StatusTransitionEntityType } from '../records.js';
import type {
  AttemptStatus,
  PaymentStatus,
  ReviewReason,
} from '../statuses.js';

export interface TransitionRow {
  readonly id: string;
  readonly entityType: StatusTransitionEntityType;
  readonly entityId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly trigger: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface PaymentEventRow {
  readonly id: string;
  readonly type: string;
  readonly paymentId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

export interface AttemptDetailRow {
  readonly id: string;
  readonly gatewayId: string;
  readonly status: AttemptStatus;
  readonly providerRef: string | null;
  readonly nextAction: unknown;
  readonly reviewReason: ReviewReason | null;
  readonly reviewOpenedAt: Date | null;
  readonly refundRequired: boolean;
  /** From `providerMetadata.providerReportedAmount`, when present. */
  readonly providerReportedAmount: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly transitions: TransitionRow[];
}

export interface PaymentDetailRow {
  readonly id: string;
  readonly upstreamReference: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly attempts: AttemptDetailRow[];
  readonly events: PaymentEventRow[];
}

/** Read model behind the operator Payment detail (ADR 0005). Read only. */
export abstract class PaymentDetailReadRepository {
  /** The Payment with attempts, transitions and events; null if none (or not a UUID). */
  abstract find(scope: ReadScope, id: string): Promise<PaymentDetailRow | null>;
}
