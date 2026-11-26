import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import {
  PaymentEventsReadRepository,
  type PaymentEventDetailRow,
  type PaymentEventListQuery,
  type PaymentEventSummaryRow,
} from '../../../domain/repositories/console-read/payment-events-read.repository.js';
import { isIsoTime, keysetCursor, type Page } from './keyset-cursor.js';

/** The Payment Events list cursor: newest first by `createdAt`. */
export const paymentEventsCursor = keysetCursor<PaymentEventSummaryRow>({
  tag: 'payment-events',
  valueOf: (row) => row.createdAt.toISOString(),
  isValue: isIsoTime,
});

/** The operator Payment Events list (`GET /internal/payment-events`). Read only (ADR 0005). */
@Injectable()
export class ListPaymentEvents {
  constructor(
    @Inject(PaymentEventsReadRepository)
    private readonly events: PaymentEventsReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    query: PaymentEventListQuery,
  ): Promise<Page<PaymentEventSummaryRow>> {
    const rows = await this.events.list(scope, query);
    return paymentEventsCursor.page(rows, query.limit);
  }
}

/** One Payment Event with its payload; null when no event has that id. */
@Injectable()
export class GetPaymentEvent {
  constructor(
    @Inject(PaymentEventsReadRepository)
    private readonly events: PaymentEventsReadRepository,
  ) {}

  execute(scope: ReadScope, id: string): Promise<PaymentEventDetailRow | null> {
    return this.events.findById(scope, id);
  }
}
