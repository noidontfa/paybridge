import { Inject, Injectable } from '@nestjs/common';
import {
  PaymentDetailReadRepository,
  type PaymentDetailRow,
} from '../../../infrastructure/prisma/console-read/payment-detail-read.repository.js';

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

  execute(id: string): Promise<PaymentDetailRow | null> {
    return this.payments.find(id);
  }
}
