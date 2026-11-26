import { z } from 'zod';
import type { CallbackListRow } from '../../infrastructure/prisma/console-read/callbacks-read.repository.js';
import { CALLBACK_STATUSES } from '../shared/developer-views.vocab.js';
import { isIsoTime, keysetCursor } from '../shared/keyset-cursor.js';
import { optionalParam, pagingShape } from '../shared/list-query.js';

/** Newest first by `receivedAt`. */
export const callbacksCursor = keysetCursor<CallbackListRow>({
  tag: 'callbacks',
  valueOf: (row) => row.receivedAt.toISOString(),
  isValue: isIsoTime,
});

export const callbacksListQuerySchema = z
  .object({
    ...pagingShape,
    gatewayId: optionalParam(z.string().max(100)),
    status: optionalParam(z.enum(CALLBACK_STATUSES)),
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
