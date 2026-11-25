/**
 * `GET /internal/reviews` and `GET /internal/reviews/summary`: the operator
 * Reviews (the Exceptions queue). A Review is a PaymentTransaction with a
 * review reason; its id is the Attempt Key. "Exceptions" is a UI label only.
 *
 * Definitions: `state=open` is a PaymentTransaction still `REQUIRES_REVIEW`,
 * `closed` one that had a review reason and has since been resolved.
 * `resolvableAt` is the time the Review was opened plus 72 hours. The summary
 * counts `open`, `total` (open and closed) and open Reviews by reason.
 */
import { z } from 'zod';
import { request } from './client';
import { listPageSchema, type ListPage, type ListQuery } from './pagination';
import {
  attemptStatusSchema,
  decimalStringSchema,
  paymentStatusSchema,
  reviewReasonSchema,
  type ReviewReason,
} from './schemas';

export const REVIEW_SORT_COLUMNS = ['reviewOpenedAt'] as const;
export const REVIEW_STATES = ['open', 'closed'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** Hours a Review stays open before an Operator may resolve it (automatic re-query goes first). */
export const REVIEW_RESOLVABLE_AFTER_HOURS = 72;

export const reviewItemSchema = z.object({
  /** The Attempt Key of the PaymentTransaction in Review. */
  id: z.string(),
  reason: reviewReasonSchema,
  state: z.enum(REVIEW_STATES),
  gatewayId: z.string(),
  /** Status of the PaymentTransaction. */
  transactionStatus: attemptStatusSchema,
  refundRequired: z.boolean(),
  reviewOpenedAt: z.string(),
  /** Opened time plus 72 hours. */
  resolvableAt: z.string(),
  /** Null when the provider reported no amount (only AMOUNT_MISMATCH carries one). */
  providerReportedAmount: decimalStringSchema.nullable(),
  /** The Payment summary. */
  payment: z.object({
    id: z.string(),
    upstreamReference: z.string(),
    amount: decimalStringSchema,
    currency: z.string(),
    status: paymentStatusSchema,
  }),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewListSchema = listPageSchema(reviewItemSchema);
export type ReviewList = ListPage<ReviewItem>;

export const reviewSummarySchema = z.object({
  open: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  byReason: z.record(reviewReasonSchema, z.number().int().nonnegative()),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export interface ReviewListQuery extends ListQuery {
  reason?: ReviewReason;
  gatewayId?: string;
  /** Defaults to `open`. */
  state?: ReviewState;
  sort?: (typeof REVIEW_SORT_COLUMNS)[number];
  /** Defaults to `asc`: the longest-waiting Review first. */
  order?: 'asc' | 'desc';
}

export function listReviews(query: ReviewListQuery, signal?: AbortSignal): Promise<ReviewList> {
  return request('/internal/reviews', reviewListSchema, { query: { ...query }, signal });
}

export function getReviewSummary(signal?: AbortSignal): Promise<ReviewSummary> {
  return request('/internal/reviews/summary', reviewSummarySchema, { signal });
}
