import { HttpStatus } from '@nestjs/common';

/**
 * HTTP status for each domain error code (see `domain/errors.ts`). A domain
 * error whose code is missing here stays unhandled and becomes a 500, so add
 * a row with every new error that can reach a controller. One row per line.
 */
export const DOMAIN_ERROR_STATUS: Readonly<Record<string, HttpStatus>> = {
  ATTEMPT_IN_REVIEW: HttpStatus.CONFLICT,
  IDEMPOTENCY_KEY_REUSED: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_AMOUNT: HttpStatus.BAD_REQUEST,
  INVALID_EXPIRY: HttpStatus.BAD_REQUEST,
  INVALID_UPSTREAM_REFERENCE: HttpStatus.BAD_REQUEST,
  OPEN_ATTEMPT_EXISTS: HttpStatus.CONFLICT,
  PAYMENT_EXPIRY_PASSED: HttpStatus.CONFLICT,
  PAYMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYMENT_NOT_PENDING: HttpStatus.CONFLICT,
  UNKNOWN_GATEWAY: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_CURRENCY: HttpStatus.BAD_REQUEST,
  UPSTREAM_REFERENCE_EXISTS: HttpStatus.CONFLICT,
};
