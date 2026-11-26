/**
 * `/internal/webhook-deliveries`: each Payment Event PayBridge delivered (or
 * tried to deliver) to one of the Organization's Webhook Endpoints, with every
 * attempt. A resend makes a new attempt of the same delivery, same event id.
 * `POST /internal/webhook-endpoints/:id/test` sends a `webhook.test` event.
 */
import { z } from 'zod';
import { request } from './client';
import { listPageSchema, type ListPage, type ListQuery } from './pagination';

export const WEBHOOK_DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export const webhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

/** The kinds a delivery can carry: the Payment Event kinds, plus test sends. */
export const WEBHOOK_DELIVERY_KINDS = [
  'payment.created',
  'payment.succeeded',
  'payment.cancelled',
  'payment.expired',
  'payment.requires_review',
  'webhook.test',
] as const;

export const webhookDeliveryListItemSchema = z.object({
  id: z.string(),
  endpoint: z.object({ id: z.string(), url: z.string() }),
  /** The Payment Event id, the same on every attempt and resend. */
  eventId: z.string(),
  eventKind: z.string(),
  /** Null for a test send. */
  paymentId: z.string().nullable(),
  status: webhookDeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  /** Null until the first attempt. */
  lastAttemptAt: z.string().nullable(),
  /** Null when there was no attempt, or no HTTP answer came. */
  lastHttpStatus: z.number().int().nullable(),
  createdAt: z.string(),
});
export type WebhookDeliveryListItem = z.infer<typeof webhookDeliveryListItemSchema>;

export const webhookDeliveryAttemptSchema = z.object({
  id: z.string(),
  attemptedAt: z.string(),
  succeeded: z.boolean(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  /** The start of the receiver's answer, truncated. Never render it as HTML. */
  responseBody: z.string().nullable(),
  /** Why the attempt failed (refused address, timeout, status), when it did. */
  error: z.string().nullable(),
  /** Who resent or test-sent it; null for an automatic attempt. */
  triggeredBy: z
    .object({
      name: z.string(),
      role: z.string(),
      /** "Super Admin (PayBridge)" for the platform, otherwise null. */
      label: z.string().nullable(),
    })
    .nullable(),
});
export type WebhookDeliveryAttempt = z.infer<typeof webhookDeliveryAttemptSchema>;

export const webhookDeliveryDetailSchema = webhookDeliveryListItemSchema.extend({
  /** When the Payment Event happened. */
  eventCreatedAt: z.string(),
  /** Every attempt, newest first. */
  history: z.array(webhookDeliveryAttemptSchema),
});
export type WebhookDeliveryDetail = z.infer<typeof webhookDeliveryDetailSchema>;

export const webhookDeliveryListSchema = listPageSchema(webhookDeliveryListItemSchema);
export type WebhookDeliveryList = ListPage<WebhookDeliveryListItem>;

export interface WebhookDeliveryListQuery extends ListQuery {
  endpointId?: string;
  status?: string;
  kind?: string;
  paymentId?: string;
}

export function listWebhookDeliveries(query: WebhookDeliveryListQuery, signal?: AbortSignal): Promise<WebhookDeliveryList> {
  return request('/internal/webhook-deliveries', webhookDeliveryListSchema, { query: { ...query }, signal });
}

export function getWebhookDelivery(id: string, signal?: AbortSignal): Promise<WebhookDeliveryDetail> {
  return request(`/internal/webhook-deliveries/${encodeURIComponent(id)}`, webhookDeliveryDetailSchema, { signal });
}

/** A new attempt of the same delivery, now; answers with the delivery and its new attempt. */
export function resendWebhookDelivery(id: string): Promise<WebhookDeliveryDetail> {
  return request(`/internal/webhook-deliveries/${encodeURIComponent(id)}/resend`, webhookDeliveryDetailSchema, {
    method: 'POST',
    body: {},
  });
}

/** Sends a `webhook.test` event to one endpoint now; answers with the test delivery. */
export function sendTestWebhook(endpointId: string): Promise<WebhookDeliveryDetail> {
  return request(`/internal/webhook-endpoints/${encodeURIComponent(endpointId)}/test`, webhookDeliveryDetailSchema, {
    method: 'POST',
    body: {},
  });
}
