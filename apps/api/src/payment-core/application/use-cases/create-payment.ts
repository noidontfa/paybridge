import { Inject, Injectable } from '@nestjs/common';
import { parseAmount } from '../../domain/amount.js';
import { Clock } from '../../domain/clock.js';
import { InvalidUpstreamReferenceError } from '../../domain/errors.js';
import { newId } from '../../domain/ids.js';
import type { Payment } from '../../domain/payment.js';
import { resolvePaymentExpiry } from '../../domain/payment-expiry.js';
import { INITIAL_PAYMENT_STATUS } from '../../domain/rules/payment-transitions.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';

export interface CreatePaymentInput {
  /** Decimal string in the currency's major unit (VND: whole dong). */
  readonly amount: string;
  /** ISO 4217 code. Only VND in Phase 1. */
  readonly currency: string;
  /** The caller's Upstream Reference. Unique across PayBridge, immutable. */
  readonly upstreamReference: string;
  /** Payment Expiry. Default 30 minutes after creation. */
  readonly expiresAt?: Date;
}

/**
 * Creates a PENDING Payment (spec: Use cases, `createPayment`). One
 * transaction inserts the Payment, its first status transition and the
 * `PaymentCreated` outbox event. No attempt is created. A duplicate upstream
 * reference fails on the database unique constraint.
 */
@Injectable()
export class CreatePayment {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async execute(input: CreatePaymentInput): Promise<Payment> {
    const amount = parseAmount(input.amount, input.currency);
    const upstreamReference = input.upstreamReference;
    if (upstreamReference.trim() === '') {
      throw new InvalidUpstreamReferenceError(
        'upstreamReference must not be empty',
      );
    }
    const expiresAt = resolvePaymentExpiry(input.expiresAt, this.clock.now());

    return this.runner.run(async (repos) => {
      const payment = await repos.payments.create({
        id: newId(),
        merchantOrderId: upstreamReference,
        amount: amount.value,
        currency: amount.currency,
        status: INITIAL_PAYMENT_STATUS,
        expiresAt,
      });
      await repos.statusTransitions.record({
        entityType: 'PAYMENT',
        entityId: payment.id,
        fromStatus: null,
        toStatus: payment.status,
        trigger: 'create_payment',
        actor: 'merchant',
      });
      await repos.outbox.add({
        eventType: 'PaymentCreated',
        paymentId: payment.id,
        payload: {
          paymentId: payment.id,
          upstreamReference: payment.merchantOrderId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          expiresAt: payment.expiresAt.toISOString(),
        },
      });
      return payment;
    });
  }
}
