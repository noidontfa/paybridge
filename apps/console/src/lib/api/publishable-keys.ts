/**
 * `/internal/publishable-keys`: an Organization's Publishable Keys (ADR 0009).
 * They are not secret, so the full key is listed every time.
 */
import { z } from 'zod';
import { request } from './client';

const writerSchema = z.object({
  name: z.string().nullable(),
  role: z.string().nullable(),
  /** How to show the writer; "Super Admin (PayBridge)" for the platform. */
  label: z.string().nullable(),
});

export const publishableKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  key: z.string(),
  allowedOrigins: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  revokedAt: z.string().nullable(),
  createdBy: writerSchema,
  updatedBy: writerSchema,
});
export type PublishableKey = z.infer<typeof publishableKeySchema>;

export const publishableKeyListSchema = z.object({ items: z.array(publishableKeySchema) });

export const PUBLISHABLE_KEY_LABEL_MAX_LENGTH = 100;

export function listPublishableKeys(signal?: AbortSignal) {
  return request('/internal/publishable-keys', publishableKeyListSchema, { signal });
}

export function createPublishableKey(input: { label: string; allowedOrigins: string[] }) {
  return request('/internal/publishable-keys', publishableKeySchema, { method: 'POST', body: input });
}

export function setPublishableKeyOrigins(id: string, allowedOrigins: string[]) {
  return request(`/internal/publishable-keys/${encodeURIComponent(id)}/allowed-origins`, publishableKeySchema, {
    method: 'POST',
    body: { allowedOrigins },
  });
}

export function revokePublishableKey(id: string) {
  return request(`/internal/publishable-keys/${encodeURIComponent(id)}/revoke`, z.object({ revoked: z.boolean() }), {
    method: 'POST',
    body: {},
  });
}
