import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  CheckoutPayments,
  type CheckoutAttemptView,
  type CheckoutPaymentView,
} from '../../../payment-core/port/payments.js';
import type { PricingPlan } from '../../domain/entities/pricing-plan.js';
import {
  CheckoutPaymentNotFoundError,
  CheckoutUnavailableError,
} from '../../domain/errors.js';
import { newCheckoutId } from '../../domain/ids.js';
import type {
  CheckoutSession,
  CheckoutSessionKey,
} from '../../domain/repositories/checkout-session.repository.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { CheckoutClock } from '../../domain/services/clock.js';
import {
  assertGatewaySellable,
  sellableGatewayIds,
} from '../../domain/services/sellable-gateways.js';
import {
  StartRateLimiter,
  type StartCaller,
} from '../../domain/services/start-rate-limiter.js';

const MINUTE_MS = 60_000;

/** What the browser sends to start or resume. It never carries an Amount. */
export interface StartCheckoutPaymentInput {
  readonly pricingPlanId: string;
  /** Opaque token the SDK keeps for the browser session; only its hash is stored. */
  readonly sessionToken: string;
  readonly customerReference?: string;
  readonly customerEmail?: string;
}

/**
 * Where the Customer goes after paying or giving up, as the Pricing Plan
 * sets it (null: not set). The checkout app's return page prefers the
 * snippet's URLs and falls back to the host page.
 */
export interface CheckoutReturnUrls {
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
}

/** A checkout Payment with its Pricing Plan's return URLs. */
export interface CheckoutPaymentWithReturnUrls {
  readonly payment: CheckoutPaymentView;
  readonly returnUrls: CheckoutReturnUrls;
}

const returnUrlsOf = (plan: PricingPlan): CheckoutReturnUrls => ({
  successUrl: plan.successUrl,
  cancelUrl: plan.cancelUrl,
});

export interface StartedCheckoutPayment extends CheckoutPaymentWithReturnUrls {
  /** True when an open Payment of the same session was returned. */
  readonly resumed: boolean;
}

export interface CheckoutAttemptRequest {
  readonly gatewayId: string;
  readonly returnUrl: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The public checkout endpoints' use cases: start or resume a checkout
 * Payment, start an attempt on it, read it. Payments are created and paid
 * only through Payment Core's public port; this module keeps which browser
 * session each one belongs to.
 */
@Injectable()
export class CheckoutPaymentFlow {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CheckoutPayments) private readonly payments: CheckoutPayments,
    @Inject(CheckoutClock) private readonly clock: CheckoutClock,
    @Inject(StartRateLimiter) private readonly rateLimiter: StartRateLimiter,
  ) {}

  private get repos() {
    return this.runner.repositories;
  }

  /**
   * Returns the open Payment for the same session token, Pricing Plan and
   * Customer Reference, or creates one with the Pricing Plan's Amount and
   * Payment Expiry. Rate-limited per Publishable Key and client IP.
   */
  async start(
    scope: OrganizationScope,
    caller: StartCaller,
    input: StartCheckoutPaymentInput,
  ): Promise<StartedCheckoutPayment> {
    await this.rateLimiter.consume(caller);
    const plan = await this.sellablePlan(scope, input.pricingPlanId);
    const key: CheckoutSessionKey = {
      sessionTokenHash: hashToken(input.sessionToken),
      pricingPlanId: plan.id,
      customerReference: input.customerReference ?? '',
      customerEmail: input.customerEmail ?? '',
    };

    const open = await this.openPayment(scope, key);
    const returnUrls = returnUrlsOf(plan);
    if (open) return { payment: open, returnUrls, resumed: true };

    const now = this.clock.now();
    const payment = await this.payments.create(scope, {
      amount: plan.amount,
      currency: plan.currency,
      expiresAfterMs: plan.expiryMinutes * MINUTE_MS,
      origin: {
        pricingPlanId: plan.id,
        pricingPlanName: plan.name,
        customerReference: input.customerReference ?? null,
        customerEmail: input.customerEmail ?? null,
      },
    });
    const session: CheckoutSession = {
      ...key,
      id: newCheckoutId(),
      publishableKeyId: caller.publishableKeyId,
      paymentId: payment.id,
      createdAt: now,
    };
    await this.repos.checkoutSessions.create(scope, session);
    return { payment, returnUrls, resumed: false };
  }

  /**
   * Starts an attempt with a gateway the Pricing Plan allows and the
   * Organization has enabled. A Payment already under way keeps working
   * after its Pricing Plan is archived.
   */
  async startAttempt(
    scope: OrganizationScope,
    paymentId: string,
    request: CheckoutAttemptRequest,
  ): Promise<CheckoutPaymentWithReturnUrls & { attempt: CheckoutAttemptView }> {
    const { payment, plan } = await this.checkoutPayment(scope, paymentId);
    assertGatewaySellable(
      plan,
      await this.payments.enabledGatewayIds(scope),
      request.gatewayId,
    );
    const started = await this.payments.startAttempt(scope, {
      paymentId: payment.id,
      gatewayId: request.gatewayId,
      returnUrl: request.returnUrl,
      description: payment.checkoutOrigin?.pricingPlanName ?? plan.name,
    });
    return { ...started, returnUrls: returnUrlsOf(plan) };
  }

  /** A checkout Payment of the Organization; any other Payment is not found. */
  async get(
    scope: OrganizationScope,
    paymentId: string,
  ): Promise<CheckoutPaymentWithReturnUrls> {
    const { payment, plan } = await this.checkoutPayment(scope, paymentId);
    return { payment, returnUrls: returnUrlsOf(plan) };
  }

  private async checkoutPayment(
    scope: OrganizationScope,
    paymentId: string,
  ): Promise<{ payment: CheckoutPaymentView; plan: PricingPlan }> {
    const session = isUuid(paymentId)
      ? await this.repos.checkoutSessions.findByPaymentId(scope, paymentId)
      : null;
    const payment = session
      ? await this.payments.find(scope, session.paymentId)
      : null;
    const plan = session
      ? await this.repos.pricingPlans.findById(scope, session.pricingPlanId)
      : null;
    if (!payment || !plan) throw new CheckoutPaymentNotFoundError(paymentId);
    return { payment, plan };
  }

  /** An active Pricing Plan with at least one gateway to pay with. */
  private async sellablePlan(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<PricingPlan> {
    const plan = isUuid(pricingPlanId)
      ? await this.repos.pricingPlans.findById(scope, pricingPlanId)
      : null;
    if (!plan) throw new CheckoutUnavailableError('PRICING_PLAN_NOT_FOUND');
    if (plan.status !== 'ACTIVE') {
      throw new CheckoutUnavailableError('PRICING_PLAN_ARCHIVED');
    }
    const enabled = await this.payments.enabledGatewayIds(scope);
    if (sellableGatewayIds(plan, enabled).length === 0) {
      throw new CheckoutUnavailableError('NO_GATEWAY_AVAILABLE');
    }
    return plan;
  }

  /** The session's latest Payment, if it is still PENDING and in time. */
  private async openPayment(
    scope: OrganizationScope,
    key: CheckoutSessionKey,
  ): Promise<CheckoutPaymentView | null> {
    const latest = await this.repos.checkoutSessions.latest(scope, key);
    if (!latest) return null;
    const payment = await this.payments.find(scope, latest.paymentId);
    const open =
      payment?.status === 'PENDING' &&
      payment.expiresAt.getTime() > this.clock.now().getTime();
    return open ? payment : null;
  }
}
