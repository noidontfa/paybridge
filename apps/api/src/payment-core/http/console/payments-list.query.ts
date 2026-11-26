import { z } from 'zod';
import { PAYMENT_STATUSES } from '../../domain/statuses.js';
import { paymentsCursor } from '../../application/use-cases/console/list-payments.js';
import { dayParam, optionalParam, pagingShape } from './list-query.js';

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
