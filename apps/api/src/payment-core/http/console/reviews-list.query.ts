import { z } from 'zod';
import { REVIEW_REASONS } from '../../domain/statuses.js';
import { optionalParam, pagingShape, readKeysetCursor } from './list-query.js';

const isIsoTime = (value: string) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

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
    const after = readKeysetCursor(
      query.cursor,
      `reviewOpenedAt:${order}`,
      isIsoTime,
    );
    if (after === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'is not valid for this list and order',
      });
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
