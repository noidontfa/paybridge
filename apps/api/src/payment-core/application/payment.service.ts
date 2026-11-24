import { Inject, Injectable } from '@nestjs/common';
import type { Payment } from '../domain/payment.js';
import {
  CreatePayment,
  type CreatePaymentInput,
} from './use-cases/create-payment.js';

/**
 * The API use cases of Payment Core (spec: Application services). A thin
 * façade: each method delegates to one class in `use-cases/`, where the rules
 * and the transaction boundary live. Add one constructor parameter and one
 * method per use case.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(CreatePayment) private readonly createPaymentUseCase: CreatePayment,
  ) {}

  createPayment(input: CreatePaymentInput): Promise<Payment> {
    return this.createPaymentUseCase.execute(input);
  }
}
