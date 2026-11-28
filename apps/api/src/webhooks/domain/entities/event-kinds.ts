import type { OutboxEventType } from '../../../payment-core/port/outbox.js';

/**
 * The Payment Event kinds a Webhook Endpoint can subscribe to, one to one
 * with Core's Payment Event types. There is no `payment.failed` or refund
 * kind, because Core emits no such Payment Event.
 */
export const PAYMENT_EVENT_KINDS = [
  'payment.created',
  'payment.succeeded',
  'payment.cancelled',
  'payment.expired',
  'payment.requires_review',
] as const;
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];

const KIND_OF: Record<OutboxEventType, PaymentEventKind> = {
  PaymentCreated: 'payment.created',
  PaymentSucceeded: 'payment.succeeded',
  PaymentCancelled: 'payment.cancelled',
  PaymentExpired: 'payment.expired',
  PaymentRequiresReview: 'payment.requires_review',
};

/** The Webhook kind of a Core Payment Event type, or null for an unknown one. */
export function eventKindOf(type: string): PaymentEventKind | null {
  return Object.hasOwn(KIND_OF, type) ? KIND_OF[type as OutboxEventType] : null;
}
