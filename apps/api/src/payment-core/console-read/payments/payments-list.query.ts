import { z } from 'zod';
import { PAYMENT_STATUSES } from '../../domain/statuses.js';
import type {
  PaymentListRow,
  PaymentSortColumn,
} from '../../infrastructure/prisma/console-read/payments-read.repository.js';
import { isIsoTime, keysetCursor } from '../shared/keyset-cursor.js';
import { dayParam, optionalParam, pagingShape } from '../shared/list-query.js';

const DECIMAL = /^\d+(\.\d+)?$/;

/** A cursor only continues the sort and order it was made for. */
export function paymentsCursor(sort: PaymentSortColumn, order: 'asc' | 'desc') {
  return keysetCursor<PaymentListRow>({
    tag: `${sort}:${order}`,
    valueOf: (row) =>
      sort === 'amount' ? row.amount : row.createdAt.toISOString(),
    isValue: sort === 'amount' ? (v) => DECIMAL.test(v) : isIsoTime,
    invalidMessage: 'is not valid for this list, sort and order',
  });
}

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
    const after = paymentsCursor(sort, order).parse(ctx, query.cursor);
    if (after === null) {
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
