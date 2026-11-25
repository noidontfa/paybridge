/**
 * `GET /internal/callbacks` and `GET /internal/callbacks/:id`: what each
 * PaymentGateway sent (Callbacks). A Callback is inbound only; it is
 * not a Payment Event.
 */
import { z } from 'zod';
import { request } from './client';
import { listPageSchema, type ListPage, type ListQuery } from './pagination';

/** The inbox statuses (API `WebhookInboxStatus`). */
export const CALLBACK_STATUSES = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'] as const;
export const callbackStatusSchema = z.enum(CALLBACK_STATUSES);
export type CallbackStatus = z.infer<typeof callbackStatusSchema>;

export const callbackListItemSchema = z.object({
  id: z.string(),
  gatewayId: z.string(),
  /** Absent when the gateway sent no event id. */
  providerEventId: z.string().nullable(),
  /** The Attempt Key (PaymentTransaction id) the Callback names, if any. */
  attemptKey: z.string().nullable(),
  status: callbackStatusSchema,
  /** Delivery attempts (processing tries so far). */
  attempts: z.number().int().nonnegative(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
});
export type CallbackListItem = z.infer<typeof callbackListItemSchema>;

export const callbackDetailSchema = callbackListItemSchema.extend({
  /** Allow-listed per plugin. */
  headers: z.record(z.string(), z.string()),
  query: z.record(z.string(), z.string()),
  /** The body exactly as received, as text. Never render it as HTML. */
  rawBody: z.string(),
  lastError: z.string().nullable(),
  /** The Payment of the PaymentTransaction the Attempt Key names; null when it matches none. */
  paymentId: z.string().nullable(),
});
export type CallbackDetail = z.infer<typeof callbackDetailSchema>;

export const callbackListSchema = listPageSchema(callbackListItemSchema);
export type CallbackList = ListPage<CallbackListItem>;

export interface CallbackListQuery extends ListQuery {
  gatewayId?: string;
  status?: string;
}

export function listCallbacks(query: CallbackListQuery, signal?: AbortSignal): Promise<CallbackList> {
  return request('/internal/callbacks', callbackListSchema, { query: { ...query }, signal });
}

export function getCallback(id: string, signal?: AbortSignal): Promise<CallbackDetail> {
  return request(`/internal/callbacks/${encodeURIComponent(id)}`, callbackDetailSchema, { signal });
}
