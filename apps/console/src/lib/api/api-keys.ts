/**
 * `/internal/api-keys`: an Organization's API Keys. Creating returns the full
 * key once; listing never does.
 */
import { z } from 'zod';
import { request } from './client';

export const apiKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const apiKeyListSchema = z.object({ items: z.array(apiKeySchema) });
export const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const API_KEY_LABEL_MAX_LENGTH = 100;

export function listApiKeys(signal?: AbortSignal) {
  return request('/internal/api-keys', apiKeyListSchema, { signal });
}

export function createApiKey(label: string) {
  return request('/internal/api-keys', createdApiKeySchema, { method: 'POST', body: { label } });
}

export function revokeApiKey(id: string) {
  return request(`/internal/api-keys/${encodeURIComponent(id)}/revoke`, z.object({ revoked: z.boolean() }), {
    method: 'POST',
    body: {},
  });
}
