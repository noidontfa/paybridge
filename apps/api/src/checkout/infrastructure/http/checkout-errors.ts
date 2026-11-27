import {
  HttpStatus,
  UnprocessableEntityException,
  type HttpException,
} from '@nestjs/common';
import {
  errorRule,
  MapErrors,
  type ErrorRule,
} from '../../../common/http/map-errors.js';
import {
  CheckoutError,
  CheckoutPaymentNotFoundError,
  CheckoutRateLimitedError,
  CheckoutUnavailableError,
  InvalidPricingPlanError,
  InvalidPricingTableError,
  PricingPlanInPricingTablesError,
  PricingPlanInUseError,
  PricingPlanNotFoundError,
  PricingTableNotFoundError,
  UNAVAILABLE_MESSAGE,
} from '../../domain/errors.js';

const codeOf = (error: CheckoutError) => error.code;

/**
 * The one answer a Customer's browser gets when the checkout cannot serve it:
 * 422 `CHECKOUT_UNAVAILABLE`, with the reason only in `details.reason`.
 * `reason` is an `UnavailableReason`, or the code of a guard error that
 * `CheckoutUnavailableFilter` passes through.
 */
export function checkoutUnavailable(reason: string): HttpException {
  return new UnprocessableEntityException({
    message: UNAVAILABLE_MESSAGE,
    code: 'CHECKOUT_UNAVAILABLE',
    details: { reason },
  });
}

/** How each checkout rule broken by the caller is answered (first match wins). */
export const CHECKOUT_ERROR_RULES: readonly ErrorRule[] = [
  errorRule({
    error: InvalidPricingPlanError,
    status: HttpStatus.BAD_REQUEST,
    code: codeOf,
    details: (e) => ({ field: e.field }),
  }),
  errorRule({
    error: InvalidPricingTableError,
    status: HttpStatus.BAD_REQUEST,
    code: codeOf,
    details: (e) => ({ field: e.field }),
  }),
  errorRule({
    error: PricingPlanNotFoundError,
    status: HttpStatus.NOT_FOUND,
    code: codeOf,
  }),
  errorRule({
    error: PricingTableNotFoundError,
    status: HttpStatus.NOT_FOUND,
    code: codeOf,
  }),
  errorRule({
    error: CheckoutPaymentNotFoundError,
    status: HttpStatus.NOT_FOUND,
    code: codeOf,
  }),
  errorRule({
    error: PricingPlanInUseError,
    status: HttpStatus.CONFLICT,
    code: codeOf,
  }),
  errorRule({
    error: PricingPlanInPricingTablesError,
    status: HttpStatus.CONFLICT,
    code: codeOf,
  }),
  errorRule({
    error: CheckoutUnavailableError,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: codeOf,
    details: (e) => ({ reason: e.reason }),
  }),
  errorRule({
    error: CheckoutRateLimitedError,
    status: HttpStatus.TOO_MANY_REQUESTS,
    code: codeOf,
    details: (e) => ({
      limit: e.limit,
      retryAfterSeconds: e.retryAfterSeconds,
    }),
    headers: (e) => ({ 'Retry-After': String(e.retryAfterSeconds) }),
  }),
  // Any other checkout rule.
  errorRule({
    error: CheckoutError,
    status: HttpStatus.BAD_REQUEST,
    code: codeOf,
  }),
];

/** Maps checkout domain errors to HTTP errors on the checkout controllers. */
export const MapCheckoutErrors = () => MapErrors(CHECKOUT_ERROR_RULES);
