import { z } from 'zod';
import { WEBHOOK_INBOX_STATUSES } from '../../domain/records.js';
import { callbacksCursor } from '../../application/use-cases/console/callbacks.js';
import { optionalParam, pagingShape } from './list-query.js';

export const callbacksListQuerySchema = z
  .object({
    ...pagingShape,
    gatewayId: optionalParam(z.string().max(100)),
    status: optionalParam(z.enum(WEBHOOK_INBOX_STATUSES)),
    q: optionalParam(z.string().trim().max(200)),
  })
  .transform((query, ctx) => {
    const after = callbacksCursor.parse(ctx, query.cursor);
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
