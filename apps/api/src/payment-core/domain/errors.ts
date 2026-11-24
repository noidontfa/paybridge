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
