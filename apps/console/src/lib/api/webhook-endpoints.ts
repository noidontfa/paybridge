/**
 * `/internal/webhook-endpoints`: an Organization's Webhook Endpoints. Creating
 * returns the full signing secret once; listing shows only its prefix. Edits
 * are POSTs (the BFF forwards no PUT or PATCH).
 */
import { z } from 'zod';
import { request } from '@/services/client';

const BASE = '/internal/webhook-endpoints';

/** The Payment Event kinds an endpoint can subscribe to. */
export const WEBHOOK_EVENT_KINDS = [
  'payment.created',
  'payment.succeeded',
  'payment.cancelled',
  'payment.expired',
  'payment.requires_review',
] as const;
export type WebhookEventKind = (typeof WEBHOOK_EVENT_KINDS)[number];

export const webhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  eventKinds: z.array(z.string()),
  status: z.enum(['ENABLED', 'DISABLED']),
  secretPrefix: z.string(),
  /** While set, Webhooks are signed with the previous secret too, until then. */
  previousSecretExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.object({
    name: z.string(),
    role: z.string(),
    /** Set for a Super Admin, who is shown as the platform. */
    label: z.string().nullable(),
  }),
  /** In the list only: its latest attempts all failed. */
  failing: z.boolean().optional(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const webhookEndpointListSchema = z.object({ items: z.array(webhookEndpointSchema) });
export const createdWebhookEndpointSchema = webhookEndpointSchema.extend({ secret: z.string() });
export type CreatedWebhookEndpoint = z.infer<typeof createdWebhookEndpointSchema>;

export interface WebhookEndpointInput {
  url: string;
  eventKinds: WebhookEventKind[];
}

export function listWebhookEndpoints(signal?: AbortSignal) {
  return request(BASE, webhookEndpointListSchema, { signal });
}

export function createWebhookEndpoint(input: WebhookEndpointInput) {
  return request(BASE, createdWebhookEndpointSchema, { method: 'POST', body: input });
}

export function updateWebhookEndpoint(id: string, input: Partial<WebhookEndpointInput>) {
  return request(`${BASE}/${encodeURIComponent(id)}`, webhookEndpointSchema, { method: 'POST', body: input });
}

export function setWebhookEndpointEnabled(id: string, enabled: boolean) {
  return request(`${BASE}/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, webhookEndpointSchema, {
    method: 'POST',
    body: {},
  });
}

/** How long the old secret stays valid after a roll. */
export const SECRET_OVERLAPS = [
  { value: 'now', label: 'Not at all' },
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
] as const;
export type SecretOverlap = (typeof SECRET_OVERLAPS)[number]['value'];

/** Replaces the signing secret; the new one is returned only here. */
export function rollWebhookEndpointSecret(id: string, previousSecretValidFor: SecretOverlap) {
  return request(`${BASE}/${encodeURIComponent(id)}/roll-secret`, createdWebhookEndpointSchema, {
    method: 'POST',
    body: { previousSecretValidFor },
  });
}

export async function deleteWebhookEndpoint(id: string): Promise<void> {
  await request(`${BASE}/${encodeURIComponent(id)}`, z.undefined(), { method: 'DELETE' });
}
