import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  CheckoutEndpoint,
  CurrentCheckout,
  type CheckoutCaller,
} from '../../../identity/port/index.js';
import { organizationScope } from '../../../payment-core/port/organization-scope.js';
import type { CheckoutAttemptView } from '../../../payment-core/port/payments.js';
import {
  CheckoutPaymentFlow,
  type CheckoutPaymentWithReturnUrls,
} from '../../application/use-cases/checkout-payments.js';
import { CheckoutErrorInterceptor } from './checkout-error.interceptor.js';
import { CheckoutUnavailableFilter } from './checkout-unavailable.filter.js';

// The browser sends no Amount: unknown fields (an `amount` among them) are
// dropped, and the Amount always comes from the Pricing Plan.
const startSchema = z.object({
  pricingPlanId: z.string().trim().min(1).max(64),
  sessionToken: z.string().min(16).max(256),
  customerReference: z.string().trim().min(1).max(200).optional(),
  customerEmail: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase())
    .optional(),
});
type StartBody = z.output<typeof startSchema>;

const webUrl = z.url({ protocol: /^https?$/ });

// The return URL a gateway gets stays short (Payment id, key, host origin,
// language); the host page and snippet URLs, which may be long, travel here
// and are kept with the checkout session for the return page.
const attemptSchema = z.object({
  gatewayId: z.string().trim().min(1).max(64),
  returnUrl: webUrl.max(2048),
  returnContext: z
    .object({
      hostPageUrl: webUrl.max(8192),
      successUrl: webUrl.max(8192).nullish(),
      cancelUrl: webUrl.max(8192).nullish(),
    })
    .transform((context) => ({
      hostPageUrl: context.hostPageUrl,
      successUrl: context.successUrl ?? null,
      cancelUrl: context.cancelUrl ?? null,
    }))
    .optional(),
});
type AttemptBody = z.output<typeof attemptSchema>;

const attemptView = (attempt: CheckoutAttemptView) => ({
  id: attempt.id,
  gatewayId: attempt.gatewayId,
  status: attempt.status,
  nextAction: attempt.nextAction,
});

/**
 * What the checkout page may know of a Payment: no Customer data echoed
 * back. `returnUrls` are the Pricing Plan's and `returnContext` what the
 * checkout page sent with its latest attempt, both for the return page.
 */
const paymentView = ({
  payment,
  returnUrls,
  returnContext,
}: CheckoutPaymentWithReturnUrls) => {
  const latest = payment.attempts.at(-1);
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    expiresAt: payment.expiresAt.toISOString(),
    pricingPlan: payment.checkoutOrigin
      ? {
          id: payment.checkoutOrigin.pricingPlanId,
          name: payment.checkoutOrigin.pricingPlanName,
        }
      : null,
    returnUrls,
    returnContext,
    attempt: latest ? attemptView(latest) : null,
  };
};

interface ClientRequest {
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

/**
 * Public checkout endpoints for Payments (`/api/checkout/payments`), called
 * from the browser with a Publishable Key from an allowed origin (ADR 0009).
 */
@ApiTags('checkout')
@CheckoutEndpoint()
@UseFilters(CheckoutUnavailableFilter)
@UseInterceptors(CheckoutErrorInterceptor)
@Controller('checkout/payments')
export class CheckoutPaymentsController {
  constructor(
    @Inject(CheckoutPaymentFlow) private readonly flow: CheckoutPaymentFlow,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Start or resume a checkout Payment for a Pricing Plan',
    description:
      '201 with a new Payment, or 200 with the open Payment of the same session token, Pricing Plan and Customer Reference. The Amount and Payment Expiry come from the Pricing Plan.',
  })
  async start(
    @CurrentCheckout() caller: CheckoutCaller,
    @Req() request: ClientRequest,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
    @Body(new ZodValidationPipe(startSchema)) body: StartBody,
  ) {
    const result = await this.flow.start(
      organizationScope(caller.organizationId),
      {
        publishableKeyId: caller.publishableKeyId,
        clientIp: request.ip ?? request.socket?.remoteAddress ?? 'unknown',
      },
      body,
    );
    response.status(result.resumed ? HttpStatus.OK : HttpStatus.CREATED);
    return { ...paymentView(result), resumed: result.resumed };
  }

  @Get(':paymentId')
  @ApiOperation({ summary: "Read a checkout Payment's status" })
  async get(
    @CurrentCheckout() caller: CheckoutCaller,
    @Param('paymentId') paymentId: string,
  ) {
    return paymentView(
      await this.flow.get(organizationScope(caller.organizationId), paymentId),
    );
  }

  @Post(':paymentId/attempts')
  @ApiOperation({
    summary: 'Start an attempt on a checkout Payment',
    description:
      "Returns the attempt with its NextAction. The gateway must be allowed by the Pricing Plan and enabled for the Organization.",
  })
  async startAttempt(
    @CurrentCheckout() caller: CheckoutCaller,
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(attemptSchema)) body: AttemptBody,
  ) {
    const result = await this.flow.startAttempt(
      organizationScope(caller.organizationId),
      paymentId,
      body,
    );
    return {
      attempt: attemptView(result.attempt),
      payment: paymentView(result),
    };
  }
}
