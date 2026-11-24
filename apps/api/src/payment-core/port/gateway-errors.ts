import type { CallbackAck } from './payment-gateway.port.js';

export type GatewayErrorCategory =
  | 'GatewayRejected'
  | 'GatewayUnavailable'
  | 'OutcomeUnknown'
  | 'InvalidCallback'
  | 'NotFound';

/**
 * Base of the five error categories a Gateway Plugin may throw. Core reacts to
 * `category` and `retryable` only, never to provider details.
 */
export abstract class GatewayError extends Error {
  abstract readonly category: GatewayErrorCategory;
  abstract readonly retryable: boolean;
}

/** Clear provider rejection. Core moves the attempt to `FAILED`. */
export class GatewayRejectedError extends GatewayError {
  readonly category = 'GatewayRejected';
  readonly retryable = false;
  override readonly name = 'GatewayRejectedError';
}

/**
 * Timeout, server error or network error before the provider accepted the
 * request. Retried; the attempt state does not change.
 */
export class GatewayUnavailableError extends GatewayError {
  readonly category = 'GatewayUnavailable';
  readonly retryable = true;
  override readonly name = 'GatewayUnavailableError';
}

/**
 * Timeout after the request was sent. Not retried directly; the attempt is
 * kept and re-queried by the scheduler.
 */
export class OutcomeUnknownError extends GatewayError {
  readonly category = 'OutcomeUnknown';
  readonly retryable = false;
  override readonly name = 'OutcomeUnknownError';
}

/**
 * Signature or payload invalid. Nothing is processed; Core returns `ack`
 * (the error acknowledgement in the provider's format) to the caller.
 */
export class InvalidCallbackError extends GatewayError {
  readonly category = 'InvalidCallback';
  readonly retryable = false;
  override readonly name = 'InvalidCallbackError';

  constructor(
    message: string,
    readonly ack: CallbackAck,
  ) {
    super(message);
  }
}

/** The provider has no such transaction. Core decides what that means. */
export class GatewayNotFoundError extends GatewayError {
  readonly category = 'NotFound';
  readonly retryable = false;
  override readonly name = 'GatewayNotFoundError';
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}
