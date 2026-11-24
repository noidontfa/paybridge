import { HttpStatus } from '@nestjs/common';

/**
 * HTTP status for each domain error code (see `domain/errors.ts`). A domain
 * error whose code is missing here stays unhandled and becomes a 500, so add
 * a row with every new error that can reach a controller. One row per line.
 */
export const DOMAIN_ERROR_STATUS: Readonly<Record<string, HttpStatus>> = {
  INVALID_AMOUNT: HttpStatus.BAD_REQUEST,
  INVALID_EXPIRY: HttpStatus.BAD_REQUEST,
  INVALID_UPSTREAM_REFERENCE: HttpStatus.BAD_REQUEST,
  PAYMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  UNSUPPORTED_CURRENCY: HttpStatus.BAD_REQUEST,
};
