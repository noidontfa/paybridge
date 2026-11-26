import type { ReadScope } from '../organization-scope.js';
import type { OutboxEventType } from '../records.js';

export interface PaymentEventListFilters {
  readonly type?: OutboxEventType;
  /** `true`: relay has published it; `false`: still waiting. */
  readonly published?: boolean;
  /** Event id or Payment id (exact), or part of the Upstream Reference. */
  readonly q?: string;
}

export interface PaymentEventListQuery {
  readonly filters: PaymentEventListFilters;
  /** `createdAt` and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface PaymentEventSummaryRow {
  readonly id: string;
  readonly type: OutboxEventType;
  readonly paymentId: string;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

export interface PaymentEventDetailRow extends PaymentEventSummaryRow {
  readonly payload: Record<string, unknown>;
}

/** Read model behind the operator Payment Events pages. Read only. */
export abstract class PaymentEventsReadRepository {
  /** Up to `limit + 1` rows, newest first, without payloads. */
  abstract list(
    scope: ReadScope,
    query: PaymentEventListQuery,
  ): Promise<PaymentEventSummaryRow[]>;

  abstract findById(
    scope: ReadScope,
    id: string,
  ): Promise<PaymentEventDetailRow | null>;
}
