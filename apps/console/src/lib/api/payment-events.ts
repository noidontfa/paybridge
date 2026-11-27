/**
 * `GET /internal/payment-events` and `GET /internal/payment-events/:id`: the
 * outbox as the Operator sees it. The list leaves the payload out; the detail
 * adds it.
 */
import { z } from 'zod';
import { request } from '@/services/client';
import { listPageSchema, type ListPage, type ListQuery } from '@/services/pagination';
import { paymentEventSchema, type PaymentEvent, type PaymentEventType } from './schemas';

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

export function listPaymentEvents(query: PaymentEventListQuery, signal?: AbortSignal): Promise<PaymentEventList> {
  return request('/internal/payment-events', paymentEventListSchema, { query: { ...query }, signal });
}

export function getPaymentEvent(id: string, signal?: AbortSignal): Promise<PaymentEvent> {
  return request(`/internal/payment-events/${encodeURIComponent(id)}`, paymentEventSchema, { signal });
}
