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

// --- Attempts (ticket 15) ---------------------------------------------------

/** The Payment is no longer `PENDING`, so it accepts no new attempt. */
export class PaymentNotPendingError extends DomainError {
  readonly code = 'PAYMENT_NOT_PENDING';

  constructor(
    readonly paymentId: string,
    readonly status: string,
  ) {
    super(`Payment ${paymentId} is ${status}, not PENDING`);
  }
}

/** The Payment Expiry has passed: no new attempt (the expiry sweep closes it). */
export class PaymentExpiryPassedError extends DomainError {
  readonly code = 'PAYMENT_EXPIRY_PASSED';

  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} has passed its expiry`);
  }
}

/** Another attempt is `CREATED` or `PENDING` (invariant 6a). */
export class OpenAttemptExistsError extends DomainError {
  readonly code = 'OPEN_ATTEMPT_EXISTS';

  constructor(
    readonly paymentId: string,
    readonly attemptId: string,
  ) {
    super(`Payment ${paymentId} already has an open attempt ${attemptId}`);
  }
}

/** An attempt in `REQUIRES_REVIEW` blocks new attempts (invariant 6b). */
export class AttemptInReviewError extends DomainError {
  readonly code = 'ATTEMPT_IN_REVIEW';

  constructor(
    readonly paymentId: string,
    readonly attemptId: string,
  ) {
    super(
      `Payment ${paymentId} has attempt ${attemptId} in review; no new attempt is accepted`,
    );
  }
}

/** The requested gateway identifier has no registered Gateway Plugin. */
export class UnknownGatewayIdError extends InvalidInputError {
  readonly code = 'UNKNOWN_GATEWAY';

  constructor(readonly gatewayId: string) {
    super(`Gateway ${JSON.stringify(gatewayId)} is not available`);
  }
}

/** A move the attempt state table does not allow. A Core bug, not a client error. */
export class InvalidAttemptTransitionError extends DomainError {
  readonly code = 'INVALID_ATTEMPT_TRANSITION';

  constructor(
    readonly attemptId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Attempt ${attemptId} cannot move from ${from} to ${to}`);
  }
}

// --- Operator review resolution (ticket 29) ---------------------------------

/** The Payment has no attempt with this id. */
export class AttemptNotFoundError extends DomainError {
  readonly code = 'ATTEMPT_NOT_FOUND';

  constructor(
    readonly paymentId: string,
    readonly attemptId: string,
  ) {
    super(`Payment ${paymentId} has no attempt ${attemptId}`);
  }
}

/** The attempt is not in `REQUIRES_REVIEW`, so there is nothing to resolve. */
export class AttemptNotInReviewError extends DomainError {
  readonly code = 'ATTEMPT_NOT_IN_REVIEW';

  constructor(
    readonly attemptId: string,
    readonly status: string,
  ) {
    super(`Attempt ${attemptId} is ${status}, not REQUIRES_REVIEW`);
  }
}

/** The review has been open for less than 72 hours: re-queries still own it. */
export class ReviewWindowOpenError extends DomainError {
  readonly code = 'REVIEW_WINDOW_OPEN';

  constructor(
    readonly attemptId: string,
    readonly eligibleAt: Date,
  ) {
    super(
      `Review of attempt ${attemptId} can be resolved by an operator from ${eligibleAt.toISOString()}`,
    );
  }

  override get details(): Readonly<Record<string, unknown>> {
    return { eligibleAt: this.eligibleAt.toISOString() };
  }
}

/** The requested resolution would create an invalid state, or needs input it lacks. */
export class ReviewResolutionNotAllowedError extends DomainError {
  readonly code = 'REVIEW_RESOLUTION_NOT_ALLOWED';
}

/** The Organization has no Gateway Connection for the gateway. */
export class GatewayNotConnectedError extends DomainError {
  readonly code = 'GATEWAY_NOT_CONNECTED';

  constructor(readonly gatewayId: string) {
    super(
      `Gateway ${JSON.stringify(gatewayId)} is not connected for this Organization`,
    );
  }
}

/** The Organization's Gateway Connection is disabled: no new PaymentTransactions. */
export class GatewayDisabledError extends DomainError {
  readonly code = 'GATEWAY_DISABLED';

  constructor(readonly gatewayId: string) {
    super(
      `Gateway ${JSON.stringify(gatewayId)} is disabled for this Organization`,
    );
  }
}

export class GatewayConnectionNotFoundError extends DomainError {
  readonly code = 'GATEWAY_CONNECTION_NOT_FOUND';

  constructor(readonly connectionId: string) {
    super(`Gateway Connection ${connectionId} not found`);
  }
}

export class GatewayConnectionExistsError extends DomainError {
  readonly code = 'GATEWAY_CONNECTION_EXISTS';

  constructor(readonly gatewayId: string) {
    super(
      `This Organization already has a Gateway Connection for ${JSON.stringify(gatewayId)}`,
    );
  }
}

/** A used Gateway Connection keeps its credentials for Refunds and reconciliation. */
export class GatewayConnectionUsedError extends DomainError {
  readonly code = 'GATEWAY_CONNECTION_USED';

  constructor(readonly connectionId: string) {
    super(
      'This Gateway Connection has PaymentTransactions and cannot be deleted; disable it instead',
    );
  }
}

/** The credentials do not fit the gateway (missing, malformed or not allowed). */
export class InvalidGatewayCredentialsError extends InvalidInputError {
  readonly code = 'INVALID_GATEWAY_CREDENTIALS';

  constructor(
    readonly gatewayId: string,
    readonly problems: readonly string[],
  ) {
    super(
      `Invalid credentials for gateway ${JSON.stringify(gatewayId)}: ${problems.join('; ')}`,
    );
  }

  override get details() {
    return { problems: this.problems };
  }
}
