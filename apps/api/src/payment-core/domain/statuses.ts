// Status vocabularies of the Payment aggregate (spec: Payment states and rules).
// Plain string unions so the domain does not depend on the ORM; the Prisma
// mappers check they stay equal to the database enums.

export const PAYMENT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Status of a PaymentTransaction (attempt). */
export const ATTEMPT_STATUSES = [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REQUIRES_REVIEW',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Open attempts: at most one per Payment (invariant 6a). */
export const OPEN_ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  'CREATED',
  'PENDING',
];

export const REVIEW_REASONS = [
  'AMBIGUOUS_PROVIDER_STATUS',
  'AMOUNT_MISMATCH',
  'LATE_SUCCESS_ON_CLOSED_PAYMENT',
  'DUPLICATE_SUCCESS',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REFUND_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REQUIRES_ACTION',
  'CANCELLED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
