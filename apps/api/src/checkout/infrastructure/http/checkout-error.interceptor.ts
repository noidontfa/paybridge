import {
  BadRequestException,
  ConflictException,
  HttpException,
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
  CheckoutUnavailableError,
  InvalidPricingPlanError,
  InvalidPricingTableError,
  PricingPlanInPricingTablesError,
  PricingPlanInUseError,
  PricingPlanNotFoundError,
  PricingTableNotFoundError,
} from '../../domain/errors.js';

/**
 * The one answer a Customer's browser gets when the checkout cannot serve it:
 * 422 `CHECKOUT_UNAVAILABLE`, with the reason only in `details.reason`.
 */
export function checkoutUnavailable(reason: string): HttpException {
  const error = new CheckoutUnavailableError(reason);
  return new UnprocessableEntityException({
    message: error.message,
    code: error.code,
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
  return new BadRequestException(body);
}

/** Maps checkout domain errors to HTTP errors on the checkout controllers. */
@Injectable()
export class CheckoutErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        throw error instanceof CheckoutError ? toHttpException(error) : error;
      }),
    );
  }
}
