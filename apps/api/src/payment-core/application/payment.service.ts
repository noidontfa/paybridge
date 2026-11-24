import { Inject, Injectable } from '@nestjs/common';
import type { Payment } from '../domain/payment.js';
import {
  CreatePayment,
  type CreatePaymentInput,
  type CreatePaymentOptions,
  type CreatePaymentResult,
} from './use-cases/create-payment.js';
import { GetPayment } from './use-cases/get-payment.js';
import {
  StartAttempt,
  type StartAttemptInput,
  type StartAttemptResult,
} from './use-cases/start-attempt.js';

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
    @Inject(GetPayment) private readonly getPaymentUseCase: GetPayment,
    @Inject(StartAttempt) private readonly startAttemptUseCase: StartAttempt,
  ) {}

  createPayment(
    input: CreatePaymentInput,
    options?: CreatePaymentOptions,
  ): Promise<CreatePaymentResult> {
    return this.createPaymentUseCase.execute(input, options);
  }

  /** Read only: no writes, no row lock. Unknown id: `PaymentNotFoundError`. */
  getPayment(paymentId: string): Promise<Payment> {
    return this.getPaymentUseCase.execute(paymentId);
  }

  startAttempt(input: StartAttemptInput): Promise<StartAttemptResult> {
    return this.startAttemptUseCase.execute(input);
  }
}
