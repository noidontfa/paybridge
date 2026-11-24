import { Inject, Injectable } from '@nestjs/common';
import type { Payment } from '../domain/payment.js';
import {
  CreatePayment,
  type CreatePaymentInput,
} from './use-cases/create-payment.js';
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
    @Inject(StartAttempt) private readonly startAttemptUseCase: StartAttempt,
  ) {}

  createPayment(input: CreatePaymentInput): Promise<Payment> {
    return this.createPaymentUseCase.execute(input);
  }

  startAttempt(input: StartAttemptInput): Promise<StartAttemptResult> {
    return this.startAttemptUseCase.execute(input);
  }
}
