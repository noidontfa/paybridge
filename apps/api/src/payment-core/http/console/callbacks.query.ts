import { z } from 'zod';
import { WEBHOOK_INBOX_STATUSES } from './developer-views.vocab.js';
import { optionalParam, pagingShape, readKeysetCursor } from './list-query.js';

export const isIsoTime = (value: string) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

export const callbacksListQuerySchema = z
  .object({
    ...pagingShape,
    gatewayId: optionalParam(z.string().max(100)),
    status: optionalParam(z.enum(WEBHOOK_INBOX_STATUSES)),
    q: optionalParam(z.string().trim().max(200)),
  })
  .transform((query, ctx) => {
    const after = readKeysetCursor(query.cursor, 'callbacks', isIsoTime);
    if (after === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'is not valid for this list',
      });
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
