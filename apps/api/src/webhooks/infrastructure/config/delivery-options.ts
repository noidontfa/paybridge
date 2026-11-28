import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import type { OutboundPolicy } from '../../domain/services/outbound-policy.js';

export interface WebhookDeliveryOptions extends OutboundPolicy {
  /** One attempt gives up after this long (about 10 seconds). */
  readonly timeoutMs: number;
  /** Characters of the response body kept on an attempt. */
  readonly responseBodyLimit: number;
}

export const WEBHOOK_DELIVERY_OPTIONS = Symbol('WEBHOOK_DELIVERY_OPTIONS');

export function resolveSsrfProtection(
  env: Pick<Env, 'NODE_ENV' | 'WEBHOOK_SSRF_PROTECTION'>,
): boolean {
  return env.WEBHOOK_SSRF_PROTECTION ?? env.NODE_ENV === 'production';
}

/** Delivery options from the environment (`WEBHOOK_*`). */
export const webhookDeliveryOptionsProvider: Provider = {
  provide: WEBHOOK_DELIVERY_OPTIONS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): WebhookDeliveryOptions => ({
    protection: resolveSsrfProtection({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      WEBHOOK_SSRF_PROTECTION: config.get('WEBHOOK_SSRF_PROTECTION', {
        infer: true,
      }),
    }),
    timeoutMs: config.get('WEBHOOK_TIMEOUT_MS', { infer: true }),
    responseBodyLimit: 1024,
  }),
};
