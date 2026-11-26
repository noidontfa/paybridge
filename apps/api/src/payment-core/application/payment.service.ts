import { Inject, Injectable } from '@nestjs/common';
import type {
  OrganizationScope,
  ReadScope,
} from '../domain/organization-scope.js';
import type { Payment } from '../domain/payment.js';
import {
  CreatePayment,
  type CreatePaymentInput,
  type CreatePaymentOptions,
  type CreatePaymentResult,
} from './use-cases/create-payment.js';
import { CancelPayment } from './use-cases/cancel-payment.js';
import { GetPayment } from './use-cases/get-payment.js';
import {
  HandleBrowserReturn,
  type BrowserReturnInput,
} from './use-cases/handle-browser-return.js';
import {
  ResolveReview,
  type ResolveReviewInput,
} from './use-cases/resolve-review.js';
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
    @Inject(CancelPayment) private readonly cancelPaymentUseCase: CancelPayment,
    @Inject(CreatePayment) private readonly createPaymentUseCase: CreatePayment,
    @Inject(GetPayment) private readonly getPaymentUseCase: GetPayment,
    @Inject(HandleBrowserReturn)
    private readonly handleBrowserReturnUseCase: HandleBrowserReturn,
    @Inject(ResolveReview)
    private readonly resolveReviewUseCase: ResolveReview,
    @Inject(StartAttempt) private readonly startAttemptUseCase: StartAttempt,
  ) {}

  /** Operator: resolve a review open 72h+, or add a note (internal route). */
  resolveReview(
    scope: OrganizationScope,
    input: ResolveReviewInput,
  ): Promise<Payment> {
    return this.resolveReviewUseCase.execute(scope, input);
  }

  /** Customer came back from the gateway: no writes, queues a status query. */
  handleBrowserReturn(
    scope: ReadScope,
    input: BrowserReturnInput,
  ): Promise<Payment> {
    return this.handleBrowserReturnUseCase.execute(scope, input);
  }

  /** Merchant cancel. No-op on CANCELLED; SUCCEEDED/EXPIRED: `PaymentNotPendingError`. */
  cancelPayment(scope: OrganizationScope, paymentId: string): Promise<Payment> {
    return this.cancelPaymentUseCase.execute(scope, paymentId);
  }

  createPayment(
    scope: OrganizationScope,
    input: CreatePaymentInput,
    options?: CreatePaymentOptions,
  ): Promise<CreatePaymentResult> {
    return this.createPaymentUseCase.execute(scope, input, options);
  }

  /** Read only: no writes, no row lock. Unknown id: `PaymentNotFoundError`. */
  getPayment(scope: OrganizationScope, paymentId: string): Promise<Payment> {
    return this.getPaymentUseCase.execute(scope, paymentId);
  }

  startAttempt(
    scope: OrganizationScope,
    input: StartAttemptInput,
  ): Promise<StartAttemptResult> {
    return this.startAttemptUseCase.execute(scope, input);
  }
}
