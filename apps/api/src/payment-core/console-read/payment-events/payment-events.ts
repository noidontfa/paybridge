import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { ReadScope } from '../../domain/organization-scope.js';
import {
  PaymentEventsReadRepository,
  type PaymentEventDetailRow,
  type PaymentEventListQuery,
  type PaymentEventSummaryRow,
} from '../../infrastructure/prisma/console-read/payment-events-read.repository.js';
import { encodeCursor, toPage, type Page } from '../shared/keyset-cursor.js';

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
    return toPage(rows, query.limit, (last) =>
      encodeCursor(['payment-events', last.createdAt.toISOString(), last.id]),
    );
  }
}

/** One Payment Event with its payload; null when no event has that id. */
@Injectable()
export class GetPaymentEvent {
  constructor(
    @Inject(PaymentEventsReadRepository)
    private readonly events: PaymentEventsReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    id: string,
  ): Promise<PaymentEventDetailRow | null> {
    return isUuid(id) ? this.events.findById(scope, id.toLowerCase()) : null;
  }
}
