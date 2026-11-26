/**
 * `GET /internal/gateways` and `GET /internal/gateways/:id`: the
 * PaymentGateways this deployment serves and the health of their Callbacks.
 * Read-only. Mode, registration and Callback URL are the API's; the Console
 * holds no gateway configuration and never sees a credential.
 */
import { z } from 'zod';
import { request } from './client';

export const gatewayModeSchema = z.enum(['test', 'live']);
export type GatewayMode = z.infer<typeof gatewayModeSchema>;

export const gatewaySummarySchema = z.object({
  id: z.string(),
  registered: z.boolean(),
  configured: z.boolean(),
  mode: gatewayModeSchema,
  callbackUrl: z.string(),
});
export type GatewaySummary = z.infer<typeof gatewaySummarySchema>;

export const gatewayListSchema = z.object({
  items: z.array(gatewaySummarySchema),
});
export type GatewayList = z.infer<typeof gatewayListSchema>;

const count = z.number().int().nonnegative();

export const gatewayDetailSchema = gatewaySummarySchema.extend({
  /** Callbacks received in the last 24 hours, by inbox status (every status is present). */
  callbackCounts: z.object({
    RECEIVED: count,
    PROCESSING: count,
    PROCESSED: count,
    FAILED: count,
  }),
  lastCallbackAt: z.string().nullable(),
  /** Gateway errors in the last 24 hours by error category, most frequent first. */
  recentErrors: z.array(
    z.object({ category: z.string(), count: z.number().int().positive() }),
  ),
});
export type GatewayDetail = z.infer<typeof gatewayDetailSchema>;

export function listGateways(signal?: AbortSignal): Promise<GatewayList> {
  return request('/internal/gateways', gatewayListSchema, { signal });
}

export function getGateway(
  id: string,
  signal?: AbortSignal,
): Promise<GatewayDetail> {
  return request(
    `/internal/gateways/${encodeURIComponent(id)}`,
    gatewayDetailSchema,
    { signal },
  );
}
