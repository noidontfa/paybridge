import type { INestApplication } from '@nestjs/common';
import { GLOBAL_PREFIX, INTERNAL_PREFIX } from './constants.js';

/**
 * Sets the public `/api` prefix. Operator routes live under `/internal` and
 * are excluded from it, so deployment can keep that prefix off the public
 * ingress (they require a User's access token).
 */
export function applyGlobalPrefix(app: INestApplication): void {
  app.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [`${INTERNAL_PREFIX}/{*path}`, '.well-known/{*path}'],
  });
}
