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
  if (error instanceof CheckoutUnavailableError) {
    // One generic answer; the reason is for the developer only.
    return new UnprocessableEntityException({
      ...body,
      details: { reason: error.reason },
    });
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
