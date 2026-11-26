/** A checkout rule was broken. `code` is the machine-readable error code. */
export abstract class CheckoutError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A Pricing Plan field is missing or out of range. */
export class InvalidPricingPlanError extends CheckoutError {
  readonly code = 'INVALID_PRICING_PLAN';

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

/** No such Pricing Plan in the caller's Organization. */
export class PricingPlanNotFoundError extends CheckoutError {
  readonly code = 'PRICING_PLAN_NOT_FOUND';

  constructor(id: string) {
    super(`Pricing Plan ${id} not found`);
  }
}

/** A Pricing Plan that Payments reference is archived, never deleted. */
export class PricingPlanInUseError extends CheckoutError {
  readonly code = 'PRICING_PLAN_IN_USE';

  constructor(id: string) {
    super(
      `Pricing Plan ${id} has Payments, so it cannot be deleted; archive it instead`,
    );
  }
}

/**
 * Why the checkout cannot sell. Customers see one generic "unavailable"
 * message; the reason is a machine-readable code for the developer.
 */
export const UNAVAILABLE_REASONS = [
  'PRICING_PLAN_NOT_FOUND',
  'PRICING_PLAN_ARCHIVED',
  'ORGANIZATION_SUSPENDED',
  'GATEWAY_NOT_ALLOWED',
  'GATEWAY_NOT_ENABLED',
  /** No PaymentGateway is both allowed by the Pricing Plan and enabled. */
  'NO_GATEWAY_AVAILABLE',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** The message every "unavailable" answer carries, whatever the reason. */
export const UNAVAILABLE_MESSAGE = 'Payment is not available right now';

/** The checkout cannot sell this, for `reason`. */
export class CheckoutUnavailableError extends CheckoutError {
  readonly code = 'CHECKOUT_UNAVAILABLE';

  constructor(readonly reason: UnavailableReason) {
    super(UNAVAILABLE_MESSAGE);
  }
}

/** No checkout Payment with this id was started with the Organization's keys. */
export class CheckoutPaymentNotFoundError extends CheckoutError {
  readonly code = 'PAYMENT_NOT_FOUND';

  constructor(id: string) {
    super(`Payment ${id} not found`);
  }
}

/** Which limit a burst of checkout starts hit. */
export type RateLimitScope = 'PUBLISHABLE_KEY' | 'CLIENT_IP';

/** Too many checkout Payments started in the current window. */
export class CheckoutRateLimitedError extends CheckoutError {
  readonly code = 'RATE_LIMITED';

  constructor(
    readonly limit: RateLimitScope,
    readonly retryAfterSeconds: number,
  ) {
    super('Too many checkout requests; try again later');
  }
}
