import { Inject, Injectable } from '@nestjs/common';
import type { CheckoutOrigin, Payment } from '../domain/entities/payment.js';
import type { PaymentTransaction } from '../domain/entities/payment-transaction.js';
import { newId } from '../domain/ids.js';
import { TransactionRunner } from '../domain/repositories/transaction-runner.js';
import type { AttemptStatus, PaymentStatus } from '../domain/statuses.js';
import type { OrganizationScope } from '../domain/value-objects/organization-scope.js';
import type { NextAction } from '../port/index.js';
import { GatewayManager } from './gateway-manager.js';
import { CreatePayment } from './use-cases/create-payment.js';
import { StartAttempt } from './use-cases/start-attempt.js';

/**
 * Upstream References Payment Core assigns to checkout Payments start with
 * this, so they are recognisable next to the Organization's own references.
 * The rest is a fresh UUID v7, so it stays unique within the Organization.
 */
export const CHECKOUT_UPSTREAM_REFERENCE_PREFIX = 'chk_';

export function newCheckoutUpstreamReference(): string {
  return `${CHECKOUT_UPSTREAM_REFERENCE_PREFIX}${newId()}`;
}

/** An attempt of a checkout Payment, as the checkout module sees it. */
export interface CheckoutAttemptView {
  readonly id: string;
  readonly gatewayId: string;
  readonly status: AttemptStatus;
  readonly nextAction: NextAction | null;
  readonly createdAt: Date;
}

/** A Payment, as the checkout module sees it. */
export interface CheckoutPaymentView {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly currency: string;
  readonly upstreamReference: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly checkoutOrigin: CheckoutOrigin | null;
  /** Oldest first. */
  readonly attempts: readonly CheckoutAttemptView[];
}

export interface NewCheckoutPayment {
  /** The Pricing Plan's Amount: a decimal string in the major unit. */
  readonly amount: string;
  readonly currency: string;
  readonly expiresAt: Date;
  readonly origin: CheckoutOrigin;
}

export interface CheckoutAttemptInput {
  readonly paymentId: string;
  readonly gatewayId: string;
  readonly returnUrl: string;
  readonly description?: string;
}

/**
 * What the Embedded Checkout may do with Payments, through Payment Core's
 * public port: create a checkout Payment (Core assigns its Upstream
 * Reference), read one, start an attempt with Core's own rules, and the two
 * questions the checkout asks before it sells. Every method is scoped to one
 * Organization (ADR 0006).
 */
@Injectable()
export class CheckoutPayments {
  constructor(
    @Inject(CreatePayment) private readonly createPayment: CreatePayment,
    @Inject(StartAttempt) private readonly startAttemptUseCase: StartAttempt,
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
  ) {}

  async create(
    scope: OrganizationScope,
    input: NewCheckoutPayment,
  ): Promise<CheckoutPaymentView> {
    const { payment } = await this.createPayment.execute(scope, {
      amount: input.amount,
      currency: input.currency,
      upstreamReference: newCheckoutUpstreamReference(),
      expiresAt: input.expiresAt,
      checkoutOrigin: input.origin,
    });
    return toView(payment);
  }

  /** Null when the Organization has no such Payment. */
  async find(
    scope: OrganizationScope,
    paymentId: string,
  ): Promise<CheckoutPaymentView | null> {
    const payment = await this.runner.repositories.payments.findById(
      scope,
      paymentId,
    );
    return payment ? toView(payment) : null;
  }

  /** Core's start attempt; its errors (not pending, expired, ...) pass through. */
  async startAttempt(
    scope: OrganizationScope,
    input: CheckoutAttemptInput,
  ): Promise<{ payment: CheckoutPaymentView; attempt: CheckoutAttemptView }> {
    const result = await this.startAttemptUseCase.execute(scope, input);
    return {
      payment: toView(result.payment),
      attempt: toAttemptView(result.attempt),
    };
  }

  /** PaymentGateways the Organization can start attempts with now. */
  async enabledGatewayIds(scope: OrganizationScope): Promise<string[]> {
    const connections =
      await this.runner.repositories.gatewayConnections.list(scope);
    return connections
      .filter((c) => c.enabled && this.gateways.isRegistered(c.gatewayId))
      .map((c) => c.gatewayId)
      .sort();
  }

  /** True once a Payment was created for the Pricing Plan. */
  anyForPricingPlan(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<boolean> {
    return this.runner.repositories.payments.anyForPricingPlan(
      scope,
      pricingPlanId,
    );
  }
}

function toAttemptView(attempt: PaymentTransaction): CheckoutAttemptView {
  return {
    id: attempt.id,
    gatewayId: attempt.gatewayId,
    status: attempt.status,
    nextAction: attempt.nextAction,
    createdAt: attempt.createdAt,
  };
}

function toView(payment: Payment): CheckoutPaymentView {
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    upstreamReference: payment.merchantOrderId,
    expiresAt: payment.expiresAt,
    createdAt: payment.createdAt,
    checkoutOrigin: payment.checkoutOrigin,
    attempts: payment.attempts.map(toAttemptView),
  };
}
