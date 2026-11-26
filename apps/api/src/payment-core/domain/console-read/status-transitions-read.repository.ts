import type { ReadScope } from '../organization-scope.js';
import type { StatusTransitionEntityType as TransitionEntityType } from '../records.js';

export interface StatusTransitionListFilters {
  readonly entityType?: TransitionEntityType;
  readonly entityId?: string;
  readonly trigger?: string;
  readonly actor?: string;
  /** Entity id or Payment id (exact), or part of the Upstream Reference. */
  readonly q?: string;
}

export interface StatusTransitionListQuery {
  readonly filters: StatusTransitionListFilters;
  /** `createdAt` and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface StatusTransitionRow {
  readonly id: string;
  readonly entityType: TransitionEntityType;
  readonly entityId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly trigger: string;
  readonly actor: string;
  readonly actorRole: string | null;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
  /** A Payment resolves to itself, a PaymentTransaction to its Payment, a Refund to none. */
  readonly paymentId: string | null;
}

/**
 * Read model behind the operator audit log. Each row is joined to the Payment
 * it belongs to; the join is also what lets the search match an Upstream
 * Reference. Read only.
 */
export abstract class StatusTransitionsReadRepository {
  /** Up to `limit + 1` rows, newest first. */
  abstract list(
    scope: ReadScope,
    query: StatusTransitionListQuery,
  ): Promise<StatusTransitionRow[]>;
}
