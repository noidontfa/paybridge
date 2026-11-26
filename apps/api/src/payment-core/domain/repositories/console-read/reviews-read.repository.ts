import type { ReadScope } from '../../value-objects/organization-scope.js';
import type {
  AttemptStatus,
  PaymentStatus,
  ReviewReason,
} from '../../statuses.js';

export type ReviewState = 'open' | 'closed';

export interface ReviewListFilters {
  readonly reason?: ReviewReason;
  readonly gatewayId?: string;
  /** Payment id or Attempt Key (exact, any case) or part of the Upstream Reference. */
  readonly q?: string;
  readonly state: ReviewState;
}

export interface ReviewListQuery {
  readonly filters: ReviewListFilters;
  readonly order: 'asc' | 'desc';
  /** Opening time (ISO) and Attempt Key of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface ReviewRow {
  /** The Attempt Key. */
  readonly id: string;
  readonly reason: ReviewReason;
  readonly state: ReviewState;
  readonly gatewayId: string;
  readonly transactionStatus: AttemptStatus;
  readonly refundRequired: boolean;
  readonly reviewOpenedAt: Date;
  readonly providerReportedAmount: string | null;
  readonly payment: {
    readonly id: string;
    readonly upstreamReference: string;
    readonly amount: string;
    readonly currency: string;
    readonly status: PaymentStatus;
  };
}

export interface ReviewCounts {
  readonly open: number;
  readonly total: number;
  readonly byReason: Record<ReviewReason, number>;
}

/**
 * Read model behind the operator Reviews (ADR 0005). A Review is a
 * PaymentTransaction with a review reason: open while it is still
 * `REQUIRES_REVIEW`, closed once it has left that status. Read only.
 */
export abstract class ReviewsReadRepository {
  /** Up to `limit + 1` rows, so the caller can tell whether another page exists. */
  abstract list(scope: ReadScope, query: ReviewListQuery): Promise<ReviewRow[]>;

  /** Open and total Reviews, and open ones by reason (every reason present). */
  abstract counts(scope: ReadScope): Promise<ReviewCounts>;
}
