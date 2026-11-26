import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/organization-scope.js';
import {
  PaymentDetailReadRepository,
  type PaymentDetailRow,
} from '../../../domain/console-read/payment-detail-read.repository.js';

/**
 * The operator Payment detail (`GET /internal/payments/:id`). Read only: no
 * transaction, no writes (ADR 0005). Null when there is no such Payment.
 */
@Injectable()
export class GetPaymentDetail {
  constructor(
    @Inject(PaymentDetailReadRepository)
    private readonly payments: PaymentDetailReadRepository,
  ) {}

  execute(scope: ReadScope, id: string): Promise<PaymentDetailRow | null> {
    return this.payments.find(scope, id);
  }
}
