import { Inject, Injectable } from '@nestjs/common';
import {
  CreatePayment,
  type CreatePaymentInput,
  type CreatePaymentOptions,
  type CreatePaymentResult,
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

  createPayment(
    input: CreatePaymentInput,
    options?: CreatePaymentOptions,
  ): Promise<CreatePaymentResult> {
    return this.createPaymentUseCase.execute(input, options);
  }
}
