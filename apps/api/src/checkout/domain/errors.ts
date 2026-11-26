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
