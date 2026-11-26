/**
 * `/internal/gateway-connections`: an Organization's own accounts with its
 * PaymentGateways (ADR 0007). The API never returns credentials, only the
 * names of the fields that are set; credentials travel one way, from the form
 * to the API.
 */
import { z } from 'zod';
import { request } from './client';

export const gatewayConnectionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  gatewayId: z.string(),
  enabled: z.boolean(),
  credentialsVersion: z.number().int(),
  credentialFields: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GatewayConnection = z.infer<typeof gatewayConnectionSchema>;

export const gatewayConnectionListSchema = z.object({ items: z.array(gatewayConnectionSchema) });

/** The credential fields each gateway asks for. A gateway not listed takes none. */
export const CREDENTIAL_FIELDS: Record<string, { name: string; label: string; placeholder: string }[]> = {
  stripe: [
    { name: 'secretKey', label: 'Secret key', placeholder: 'sk_live_… or rk_…' },
    { name: 'webhookSecret', label: 'Webhook signing secret', placeholder: 'whsec_…' },
    { name: 'publishableKey', label: 'Publishable key', placeholder: 'pk_…' },
  ],
};

const BASE = '/internal/gateway-connections';

export function listGatewayConnections(signal?: AbortSignal) {
  return request(BASE, gatewayConnectionListSchema, { signal });
}

export function createGatewayConnection(body: { gatewayId: string; credentials?: Record<string, string> }) {
  return request(BASE, gatewayConnectionSchema, { method: 'POST', body });
}

export function replaceGatewayCredentials(id: string, credentials: Record<string, string>) {
  return request(`${BASE}/${encodeURIComponent(id)}/credentials`, gatewayConnectionSchema, {
    method: 'POST',
    body: { credentials },
  });
}

export function setGatewayConnectionEnabled(id: string, enabled: boolean) {
  return request(`${BASE}/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, gatewayConnectionSchema, {
    method: 'POST',
  });
}

export async function deleteGatewayConnection(id: string): Promise<void> {
  await request(`${BASE}/${encodeURIComponent(id)}`, z.undefined(), { method: 'DELETE' });
}
