import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import {
  PROVIDER_QUERY_RATE_LIMIT,
  type RateLimitOptions,
} from '../../application/provider-query-rate-limiter.js';

/** Limit from config (`EXPIRY_QUERY_RATE_PER_SECOND`). */
export const providerQueryRateLimitProvider: Provider = {
  provide: PROVIDER_QUERY_RATE_LIMIT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): RateLimitOptions => ({
    max: config.get('EXPIRY_QUERY_RATE_PER_SECOND', { infer: true }),
    windowMs: 1000,
  }),
};
