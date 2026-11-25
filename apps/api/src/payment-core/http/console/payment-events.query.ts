import { z } from 'zod';
import { OUTBOX_EVENT_TYPES } from './developer-views.vocab.js';
import {
  isIsoTime,
  optionalParam,
  pagingShape,
  parseKeysetCursor,
} from './list-query.js';

export const paymentEventsListQuerySchema = z
  .object({
    ...pagingShape,
    type: optionalParam(z.enum(OUTBOX_EVENT_TYPES)),
    published: optionalParam(z.enum(['true', 'false'])),
    q: optionalParam(z.string().trim().max(200)),
  })
  .transform((query, ctx) => {
    const after = parseKeysetCursor(ctx, query.cursor, 'payment-events', isIsoTime);
    if (after === null) {
      return z.NEVER;
    }
    return {
      limit: query.limit,
      after,
      filters: {
        type: query.type,
        published: query.published === undefined ? undefined : query.published === 'true',
        q: query.q || undefined,
      },
    };
  });

export type PaymentEventsListQuery = z.output<
  typeof paymentEventsListQuerySchema
>;
