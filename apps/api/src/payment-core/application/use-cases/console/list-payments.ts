import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/organization-scope.js';
import {
  PaymentsReadRepository,
  type PaymentListFilters,
  type PaymentListRow,
  type PaymentSortColumn,
} from '../../../infrastructure/prisma/console-read/payments-read.repository.js';
import { encodeCursor, toPage, type Page } from './cursor.js';

export interface ListPaymentsInput {
  readonly filters: PaymentListFilters;
  readonly sort: PaymentSortColumn;
  readonly order: 'asc' | 'desc';
  readonly limit: number;
  /** Decoded cursor tail: sort-key value and id. */
  readonly after?: { readonly value: string; readonly id: string };
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
    input: ListPaymentsInput,
  ): Promise<Page<PaymentListRow>> {
    const rows = await this.payments.list(scope, input);
    return toPage(rows, input.limit, (last) =>
      encodeCursor([
        `${input.sort}:${input.order}`,
        input.sort === 'amount' ? last.amount : last.createdAt.toISOString(),
        last.id,
      ]),
    );
  }
}
