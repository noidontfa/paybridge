import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { CheckoutPaymentFlow } from '../application/use-cases/checkout-payments.js';
import { StartRateLimiter } from '../domain/services/start-rate-limiter.js';
import {
  RedisStartRateLimiter,
  START_RATE_LIMIT_OPTIONS,
  type StartRateLimitOptions,
} from './rate-limit/redis-start-rate-limiter.js';

/** Starting and paying checkout Payments (ticket 07), with its rate limits. */
export const checkoutPaymentsProviders: Provider[] = [
  CheckoutPaymentFlow,
  { provide: StartRateLimiter, useClass: RedisStartRateLimiter },
  {
    provide: START_RATE_LIMIT_OPTIONS,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): StartRateLimitOptions => ({
      perPublishableKey: config.get('CHECKOUT_START_RATE_LIMIT_PER_KEY', {
        infer: true,
      }),
      perClientIp: config.get('CHECKOUT_START_RATE_LIMIT_PER_IP', {
        infer: true,
      }),
      windowSeconds: config.get('CHECKOUT_START_RATE_LIMIT_WINDOW_SECONDS', {
        infer: true,
      }),
      redisUrl: config.get('REDIS_URL', { infer: true }),
      keyPrefix: config.get('QUEUE_PREFIX', { infer: true }),
    }),
  },
];
