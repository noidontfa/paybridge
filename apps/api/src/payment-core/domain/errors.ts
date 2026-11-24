/**
 * Base class of Core's domain errors. Each subclass has a stable `code` that
 * the HTTP layer maps to a response. Append new errors below; do not rename
 * codes.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PaymentNotFoundError extends DomainError {
  readonly code = 'PAYMENT_NOT_FOUND';

  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} not found`);
  }
}

/** A request to Core broke an input rule (amount, currency, expiry, ...). */
export abstract class InvalidInputError extends DomainError {}

export class InvalidAmountError extends InvalidInputError {
  readonly code = 'INVALID_AMOUNT';
}

export class UnsupportedCurrencyError extends InvalidInputError {
  readonly code = 'UNSUPPORTED_CURRENCY';

  constructor(readonly currency: string) {
    super(
      `Currency ${JSON.stringify(currency)} is not supported; Phase 1 accepts only VND`,
    );
  }
}

export class InvalidExpiryError extends InvalidInputError {
  readonly code = 'INVALID_EXPIRY';
}

export class InvalidUpstreamReferenceError extends InvalidInputError {
  readonly code = 'INVALID_UPSTREAM_REFERENCE';
}
