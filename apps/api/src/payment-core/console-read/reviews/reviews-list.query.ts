import { z } from 'zod';
import { REVIEW_REASONS } from '../../domain/statuses.js';
import type { ReviewRow } from '../../infrastructure/prisma/console-read/reviews-read.repository.js';
import { isIsoTime, keysetCursor } from '../shared/keyset-cursor.js';
import { optionalParam, pagingShape } from '../shared/list-query.js';

/** By the time the Review opened; a cursor only continues its own order. */
export function reviewsCursor(order: 'asc' | 'desc') {
  return keysetCursor<ReviewRow>({
    tag: `reviewOpenedAt:${order}`,
    valueOf: (row) => row.reviewOpenedAt.toISOString(),
    isValue: isIsoTime,
    invalidMessage: 'is not valid for this list and order',
  });
}

export const reviewsListQuerySchema = z
  .object({
    ...pagingShape,
    reason: optionalParam(z.enum(REVIEW_REASONS)),
    gatewayId: optionalParam(z.string().max(100)),
    q: optionalParam(z.string().trim().max(200)),
    state: optionalParam(z.enum(['open', 'closed'])),
    sort: optionalParam(z.enum(['reviewOpenedAt'])),
    order: optionalParam(z.enum(['asc', 'desc'])),
  })
  .transform((query, ctx) => {
    // Oldest first by default: the longest-waiting Review comes first.
    const order = query.order ?? 'asc';
    const after = reviewsCursor(order).parse(ctx, query.cursor);
    if (after === null) {
      return z.NEVER;
    }
    return {
      limit: query.limit,
      order,
      after,
      filters: {
        reason: query.reason,
        gatewayId: query.gatewayId,
        q: query.q || undefined,
        state: query.state ?? ('open' as const),
      },
    };
  });

export type ReviewsListQuery = z.output<typeof reviewsListQuerySchema>;
