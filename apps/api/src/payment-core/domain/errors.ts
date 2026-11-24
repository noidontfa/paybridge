/**
 * Base class of Core's domain errors. Each subclass has a stable `code` that
 * the HTTP layer maps to a response. Append new errors below; do not rename
 * codes.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  /** Machine-readable fields for the HTTP error body (for example an id). */
  get details(): Readonly<Record<string, unknown>> | undefined {
    return undefined;
  }

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

/** An Idempotency-Key was sent again with a different request body. */
export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor(readonly idempotencyKey: string) {
    super(
      'This Idempotency-Key was already used with a different request body',
    );
  }
}

/** A Payment with this upstream reference already exists. */
export class UpstreamReferenceExistsError extends DomainError {
  readonly code = 'UPSTREAM_REFERENCE_EXISTS';

  constructor(readonly paymentId: string) {
    super(
      `A Payment with this upstream reference already exists: ${paymentId}`,
    );
  }

  override get details(): Readonly<Record<string, unknown>> {
    return { paymentId: this.paymentId };
  }
}
