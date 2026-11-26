import { Inject, Injectable } from '@nestjs/common';
import { isDecimalString } from '../../../domain/amount.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import {
  PaymentsReadRepository,
  type PaymentListQuery,
  type PaymentListRow,
  type PaymentSortColumn,
} from '../../../infrastructure/prisma/console-read/payments-read.repository.js';
import { isIsoTime, keysetCursor, type Page } from './keyset-cursor.js';

/** The Payments list cursor; it only continues the sort and order it was made for. */
export function paymentsCursor(sort: PaymentSortColumn, order: 'asc' | 'desc') {
  return keysetCursor<PaymentListRow>({
    tag: `${sort}:${order}`,
    valueOf: (row) =>
      sort === 'amount' ? row.amount : row.createdAt.toISOString(),
    isValue: sort === 'amount' ? isDecimalString : isIsoTime,
    invalidMessage: 'is not valid for this list, sort and order',
  });
}

/**
 * The operator Payments list (`GET /internal/payments`). Read only: no
 * transaction, no writes (ADR 0005).
 */
@Injectable()
export class ListPayments {
  constructor(
    @Inject(PaymentsReadRepository)
    private readonly payments: PaymentsReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    query: PaymentListQuery,
  ): Promise<Page<PaymentListRow>> {
    const rows = await this.payments.list(scope, query);
    return paymentsCursor(query.sort, query.order).page(rows, query.limit);
  }
}
