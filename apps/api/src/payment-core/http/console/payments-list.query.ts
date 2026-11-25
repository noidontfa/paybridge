import { z } from 'zod';
import { PAYMENT_STATUSES } from '../../domain/statuses.js';
import {
  dayParam,
  optionalParam,
  pagingShape,
  readKeysetCursor,
} from './list-query.js';

const DECIMAL = /^\d+(\.\d+)?$/;
const isIsoTime = (value: string) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

export const paymentsListQuerySchema = z
  .object({
    ...pagingShape,
    status: optionalParam(z.enum(PAYMENT_STATUSES)),
    gatewayId: optionalParam(z.string().max(100)),
    q: optionalParam(z.string().trim().max(200)),
    createdFrom: optionalParam(dayParam),
    createdTo: optionalParam(dayParam),
    sort: optionalParam(z.enum(['createdAt', 'amount'])),
    order: optionalParam(z.enum(['asc', 'desc'])),
  })
  .transform((query, ctx) => {
    const sort = query.sort ?? 'createdAt';
    const order = query.order ?? 'desc';
    const after = readKeysetCursor(
      query.cursor,
      `${sort}:${order}`,
      sort === 'amount' ? (v) => DECIMAL.test(v) : isIsoTime,
    );
    if (after === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'is not valid for this list, sort and order',
      });
      return z.NEVER;
    }
    return {
      limit: query.limit,
      sort,
      order,
      after,
      filters: {
        status: query.status,
        gatewayId: query.gatewayId,
        q: query.q || undefined,
        createdFrom: query.createdFrom
          ? new Date(`${query.createdFrom}T00:00:00.000Z`)
          : undefined,
        createdTo: query.createdTo
          ? new Date(`${query.createdTo}T23:59:59.999Z`)
          : undefined,
      },
    };
  });

export type PaymentsListQuery = z.output<typeof paymentsListQuerySchema>;
