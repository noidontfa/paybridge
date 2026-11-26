import { z } from 'zod';
import { CALLBACK_STATUSES } from '../shared/developer-views.vocab.js';
import {
  isIsoTime,
  optionalParam,
  pagingShape,
  parseKeysetCursor,
} from '../shared/list-query.js';

export const callbacksListQuerySchema = z
  .object({
    ...pagingShape,
    gatewayId: optionalParam(z.string().max(100)),
    status: optionalParam(z.enum(CALLBACK_STATUSES)),
    q: optionalParam(z.string().trim().max(200)),
  })
  .transform((query, ctx) => {
    const after = parseKeysetCursor(ctx, query.cursor, 'callbacks', isIsoTime);
    if (after === null) {
      return z.NEVER;
    }
    return {
      limit: query.limit,
      after,
      filters: {
        gatewayId: query.gatewayId,
        status: query.status,
        q: query.q || undefined,
      },
    };
  });

export type CallbacksListQuery = z.output<typeof callbacksListQuerySchema>;
