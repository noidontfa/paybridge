// COPIED BY HAND from apps/console/src/lib/api/schemas.ts (client functions left out). Keep in sync: ADR 0004, ADR 0005.
// Tickets 03-07: do not edit this copy; add your own file next to it.
/**
 * Response types copied from the API (no shared contract package: ADR 0004 and
 * the map). They use the API's current wire names. When an API response
 * changes, change it here and in `src/mocks` too.
 *
 * Extension point: add one schema per endpoint below, export the inferred
 * type, and give it a function in `./client.ts`.
 */
import { z } from 'zod';

// --- Vocabularies (apps/api/src/payment-core/domain/statuses.ts, records.ts) ---

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'CANCELLED', 'EXPIRED'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const ATTEMPT_STATUSES = [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REQUIRES_REVIEW',
] as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const REVIEW_REASONS = [
  'AMBIGUOUS_PROVIDER_STATUS',
  'AMOUNT_MISMATCH',
  'LATE_SUCCESS_ON_CLOSED_PAYMENT',
  'DUPLICATE_SUCCESS',
] as const;
export const reviewReasonSchema = z.enum(REVIEW_REASONS);
export type ReviewReason = z.infer<typeof reviewReasonSchema>;

export const PAYMENT_EVENT_TYPES = [
  'PaymentCreated',
  'PaymentSucceeded',
  'PaymentCancelled',
  'PaymentExpired',
  'PaymentRequiresReview',
] as const;
export const paymentEventTypeSchema = z.enum(PAYMENT_EVENT_TYPES);
export type PaymentEventType = z.infer<typeof paymentEventTypeSchema>;

export const STATUS_TRANSITION_ENTITY_TYPES = ['PAYMENT', 'PAYMENT_TRANSACTION', 'REFUND'] as const;
export const statusTransitionEntityTypeSchema = z.enum(STATUS_TRANSITION_ENTITY_TYPES);
export type StatusTransitionEntityType = z.infer<typeof statusTransitionEntityTypeSchema>;

// --- Shared building blocks ---

/** Money crosses the wire as a decimal string in the major unit. */
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string');
const isoTimeSchema = z.string().min(1);

export const nextActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REDIRECT'), url: z.string() }),
  z.object({ type: z.literal('QR_CODE'), payload: z.string() }),
  z.object({
    type: z.literal('CLIENT_SDK'),
    token: z.string(),
    clientParams: z.record(z.string(), z.string()).optional(),
  }),
  z.object({ type: z.literal('VOUCHER'), details: z.unknown() }),
]);
export type NextAction = z.infer<typeof nextActionSchema>;

/** A row of the status-transition trail (`core_status_transitions`). */
export const statusTransitionSchema = z.object({
  id: z.string(),
  entityType: statusTransitionEntityTypeSchema,
  entityId: z.string(),
  /** Null when the entity is created. */
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  trigger: z.string(),
  actor: z.string(),
  /** Shown as the "note" of the transition. */
  reason: z.string().nullable(),
  createdAt: isoTimeSchema,
});
export type StatusTransition = z.infer<typeof statusTransitionSchema>;

/** A Payment Event from the outbox. */
export const paymentEventSchema = z.object({
  id: z.string(),
  type: paymentEventTypeSchema,
  paymentId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: isoTimeSchema,
  /** Null while the event is unpublished. */
  publishedAt: isoTimeSchema.nullable(),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

// --- GET /internal/payments/:id (operator Payment detail) ---

export const operatorAttemptSchema = z.object({
  /** The Attempt Key. */
  id: z.string(),
  gatewayId: z.string(),
  status: attemptStatusSchema,
  /** Provider Reference. */
  providerRef: z.string().nullable(),
  nextAction: nextActionSchema.optional(),
  reviewReason: reviewReasonSchema.optional(),
  reviewOpenedAt: isoTimeSchema.optional(),
  refundRequired: z.boolean(),
  /** What the provider reported, when a Review is about an amount (AMOUNT_MISMATCH). */
  providerReportedAmount: decimalStringSchema.optional(),
  createdAt: isoTimeSchema,
  updatedAt: isoTimeSchema,
  /** Oldest first. */
  transitions: z.array(statusTransitionSchema),
});
export type OperatorAttempt = z.infer<typeof operatorAttemptSchema>;

export const operatorPaymentSchema = z.object({
  id: z.string(),
  /** Upstream Reference. */
  upstreamReference: z.string(),
  amount: decimalStringSchema,
  currency: z.string(),
  status: paymentStatusSchema,
  /** Payment Expiry. */
  expiresAt: isoTimeSchema,
  createdAt: isoTimeSchema,
  updatedAt: isoTimeSchema,
  /** Oldest first. */
  attempts: z.array(operatorAttemptSchema),
  /** Oldest first. */
  events: z.array(paymentEventSchema),
});
export type OperatorPayment = z.infer<typeof operatorPaymentSchema>;

// --- Error envelope (apps/api/src/common/filters/all-exceptions.filter.ts) ---

export const apiErrorBodySchema = z.object({
  statusCode: z.number(),
  error: z.string().optional(),
  message: z.union([z.string(), z.array(z.string())]),
  code: z.string().optional(),
  details: z.unknown().optional(),
  path: z.string().optional(),
  method: z.string().optional(),
  timestamp: z.string().optional(),
  requestId: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
