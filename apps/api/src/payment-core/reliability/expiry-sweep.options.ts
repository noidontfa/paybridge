import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import {
  EXPIRY_SWEEP_OPTIONS,
  type ExpirySweepOptions,
} from './expiry-sweep.js';

/** The sweep's options from config (`EXPIRY_SWEEP_BATCH_SIZE`). */
export const expirySweepOptionsProvider: Provider = {
  provide: EXPIRY_SWEEP_OPTIONS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): ExpirySweepOptions => ({
    batchSize: config.get('EXPIRY_SWEEP_BATCH_SIZE', { infer: true }),
  }),
};
