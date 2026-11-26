import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { PaymentNotFoundError } from '../../domain/errors.js';
import type { OrganizationScope } from '../../domain/value-objects/organization-scope.js';
import type { Payment } from '../../domain/entities/payment.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';

/**
 * Reads a Payment with all its attempts, oldest first (spec: Use cases,
 * `getPayment`). Read only: it runs outside any transaction, writes no rows
 * and takes no row lock. An id that is not a UUID cannot name a Payment, so
 * it is reported as not found like any other unknown id.
 */
@Injectable()
export class GetPayment {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  async execute(scope: OrganizationScope, paymentId: string): Promise<Payment> {
    const payment = isUuid(paymentId)
      ? await this.runner.repositories.payments.findById(scope, paymentId)
      : null;
    if (!payment) throw new PaymentNotFoundError(paymentId);
    return payment;
  }
}
