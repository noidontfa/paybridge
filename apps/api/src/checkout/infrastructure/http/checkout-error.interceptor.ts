import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, type Observable } from 'rxjs';
import {
  CheckoutError,
  InvalidPricingPlanError,
  PricingPlanInUseError,
  PricingPlanNotFoundError,
} from '../../domain/errors.js';

/** The HTTP answer to a checkout rule broken by the caller. */
export function toHttpException(error: CheckoutError): HttpException {
  const body = { message: error.message, code: error.code };
  if (error instanceof InvalidPricingPlanError) {
    return new BadRequestException({ ...body, details: { field: error.field } });
  }
  if (error instanceof PricingPlanNotFoundError) return new NotFoundException(body);
  if (error instanceof PricingPlanInUseError) return new ConflictException(body);
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
