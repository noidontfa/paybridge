// COPIED BY HAND from apps/console/src/lib/api/payment-events.ts (client functions left out). Keep in sync: ADR 0004, ADR 0005.
// Do not edit this copy; change the Console file and copy again.
/**
 * `GET /internal/payment-events` and `GET /internal/payment-events/:id`: the
 * outbox as the Operator sees it. The list leaves the payload out; the detail
 * adds it.
 */
import { z } from 'zod';
import { listPageSchema, type ListPage, type ListQuery } from './pagination.js';
import { paymentEventSchema, type PaymentEventType } from './schemas.js';

export const paymentEventSummarySchema = paymentEventSchema.omit({ payload: true });
export type PaymentEventSummary = z.infer<typeof paymentEventSummarySchema>;

export const paymentEventListSchema = listPageSchema(paymentEventSummarySchema);
export type PaymentEventList = ListPage<PaymentEventSummary>;

export interface PaymentEventListQuery extends ListQuery {
  type?: PaymentEventType;
  /** `true` or `false`; unpublished events are the ones the relay has not sent. */
  published?: 'true' | 'false';
  /** Event id, Payment id or Upstream Reference (substring, case-insensitive). */
  q?: string;
}
