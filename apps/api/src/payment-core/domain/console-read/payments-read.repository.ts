import type { ReadScope } from '../organization-scope.js';
import type { AttemptStatus, PaymentStatus } from '../statuses.js';

export type PaymentSortColumn = 'createdAt' | 'amount';

export interface PaymentListFilters {
  readonly status?: PaymentStatus;
  /** Matches a Payment that has a PaymentTransaction on this gateway. */
  readonly gatewayId?: string;
  /** Payment id (exact) or part of the Upstream Reference (any case). */
  readonly q?: string;
  /** Inclusive bounds on `createdAt`. */
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

export interface PaymentListQuery {
  readonly filters: PaymentListFilters;
  readonly sort: PaymentSortColumn;
  readonly order: 'asc' | 'desc';
  /** Sort-key value and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface PaymentListRow {
  readonly id: string;
  readonly upstreamReference: string;
  /** Decimal string in the major unit. */
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Latest PaymentTransaction: greatest `createdAt`, ties broken by id. */
  readonly latestTransaction: {
    readonly gatewayId: string;
    readonly status: AttemptStatus;
  } | null;
}

/** Read model behind the operator Payments list (ADR 0005). Read only. */
export abstract class PaymentsReadRepository {
  /** Up to `limit + 1` rows, so the caller can tell whether another page exists. */
  abstract list(
    scope: ReadScope,
    query: PaymentListQuery,
  ): Promise<PaymentListRow[]>;
}
