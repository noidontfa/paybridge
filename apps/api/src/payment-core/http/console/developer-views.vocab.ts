// Vocabularies the developer views filter by. They mirror the database enums
// (`WebhookInboxStatus`, stored as Callbacks, `OutboxEventType`, `StatusTransitionEntityType`) and
// the Console's schemas.

export const CALLBACK_STATUSES = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
] as const;

export const OUTBOX_EVENT_TYPES = [
  'PaymentCreated',
  'PaymentSucceeded',
  'PaymentCancelled',
  'PaymentExpired',
  'PaymentRequiresReview',
] as const;

export const STATUS_TRANSITION_ENTITY_TYPES = [
  'PAYMENT',
  'PAYMENT_TRANSACTION',
  'REFUND',
] as const;
