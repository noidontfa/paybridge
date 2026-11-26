import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, type Observable } from 'rxjs';
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

/** The HTTP answer to a checkout rule broken by the caller. */
export function toHttpException(error: CheckoutError): HttpException {
  const body = { message: error.message, code: error.code };
  if (error instanceof InvalidPricingPlanError) {
    return new BadRequestException({ ...body, details: { field: error.field } });
  }
  if (error instanceof PricingPlanNotFoundError) return new NotFoundException(body);
  if (error instanceof PricingPlanInUseError) return new ConflictException(body);
  if (error instanceof InvalidPricingTableError) {
    return new BadRequestException({ ...body, details: { field: error.field } });
  }
  if (error instanceof PricingTableNotFoundError) return new NotFoundException(body);
  if (error instanceof PricingPlanInPricingTablesError) {
    return new ConflictException(body);
  }
  if (error instanceof CheckoutUnavailableError) {
    return checkoutUnavailable(error.reason);
  }
  if (error instanceof CheckoutPaymentNotFoundError) {
    return new NotFoundException(body);
  }
  if (error instanceof CheckoutRateLimitedError) {
    return new HttpException(
      {
        ...body,
        details: {
          limit: error.limit,
          retryAfterSeconds: error.retryAfterSeconds,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  return new BadRequestException(body);
}

/** Maps checkout domain errors to HTTP errors on the checkout controllers. */
@Injectable()
export class CheckoutErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof CheckoutRateLimitedError) {
          context
            .switchToHttp()
            .getResponse<{ setHeader(name: string, value: string): void }>()
            .setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        throw error instanceof CheckoutError ? toHttpException(error) : error;
      }),
    );
  }
}
