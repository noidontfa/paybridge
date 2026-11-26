import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter.js';
import { checkoutUnavailable } from './checkout-error.interceptor.js';

/**
 * On public checkout endpoints, the credential checks identity runs before
 * the controller (unknown or revoked key, suspended Organization, origin not
 * allowed) answer like every other "cannot sell": 404 `CHECKOUT_UNAVAILABLE`,
 * the reason in `details.reason` for the developer console only.
 */
@Catch(HttpException)
export class CheckoutUnavailableFilter implements ExceptionFilter {
  private readonly fallback: AllExceptionsFilter;

  constructor(@Inject(HttpAdapterHost) adapterHost: HttpAdapterHost) {
    this.fallback = new AllExceptionsFilter(adapterHost);
  }

  catch(exception: HttpException, host: ArgumentsHost): void {
    this.fallback.catch(toUnavailable(exception), host);
  }
}

function toUnavailable(exception: HttpException): HttpException {
  const status = exception.getStatus();
  if (status !== HttpStatus.UNAUTHORIZED && status !== HttpStatus.FORBIDDEN) {
    return exception;
  }
  const body = exception.getResponse() as {
    code?: unknown;
    details?: { reason?: unknown };
  };
  const reason =
    typeof body.details?.reason === 'string'
      ? body.details.reason
      : typeof body.code === 'string'
        ? body.code
        : 'UNAUTHORIZED';
  return checkoutUnavailable(reason);
}
