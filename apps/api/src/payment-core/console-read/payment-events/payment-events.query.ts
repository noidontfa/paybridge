import { z } from 'zod';
import type { PaymentEventSummaryRow } from '../../infrastructure/prisma/console-read/payment-events-read.repository.js';
import { OUTBOX_EVENT_TYPES } from '../shared/developer-views.vocab.js';
import { isIsoTime, keysetCursor } from '../shared/keyset-cursor.js';
import { optionalParam, pagingShape } from '../shared/list-query.js';

/** Newest first by `createdAt`. */
export const paymentEventsCursor = keysetCursor<PaymentEventSummaryRow>({
  tag: 'payment-events',
  valueOf: (row) => row.createdAt.toISOString(),
  isValue: isIsoTime,
});

export const paymentEventsListQuerySchema = z
  .object({
    ...pagingShape,
    type: optionalParam(z.enum(OUTBOX_EVENT_TYPES)),
    published: optionalParam(z.enum(['true', 'false'])),
    q: optionalParam(z.string().trim().max(200)),
  })
  .transform((query, ctx) => {
    const after = paymentEventsCursor.parse(ctx, query.cursor);
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
