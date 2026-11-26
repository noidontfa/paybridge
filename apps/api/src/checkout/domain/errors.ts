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

/** A Pricing Table field is missing or breaks a rule. */
export class InvalidPricingTableError extends CheckoutError {
  readonly code = 'INVALID_PRICING_TABLE';

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

/** No such Pricing Table in the caller's Organization. */
export class PricingTableNotFoundError extends CheckoutError {
  readonly code = 'PRICING_TABLE_NOT_FOUND';

  constructor(id: string) {
    super(`Pricing Table ${id} not found`);
  }
}

/** A Pricing Plan shown in Pricing Tables must leave them before it is deleted. */
export class PricingPlanInPricingTablesError extends CheckoutError {
  readonly code = 'PRICING_PLAN_IN_PRICING_TABLES';

  constructor(id: string) {
    super(
      `Pricing Plan ${id} is shown in Pricing Tables; remove it from them or archive it instead`,
    );
  }
}

/**
 * The public checkout endpoints cannot serve this request. The Customer sees
 * only "unavailable"; `reason` is a machine-readable code for the developer
 * console (unknown table, suspended Organization, revoked key, ...).
 */
export class CheckoutUnavailableError extends CheckoutError {
  readonly code = 'CHECKOUT_UNAVAILABLE';

  constructor(readonly reason: string) {
    super('Payment is not available right now');
  }
}
