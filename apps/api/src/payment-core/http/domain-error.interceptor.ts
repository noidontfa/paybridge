import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, catchError, throwError } from 'rxjs';
import { DomainError } from '../domain/errors.js';
import { DOMAIN_ERROR_STATUS } from './domain-error.mapping.js';

/**
 * Turns a Core `DomainError` thrown by a handler into an `HttpException` with
 * the status from `DOMAIN_ERROR_STATUS`, so the global exception filter
 * renders it in the standard envelope. Other errors pass through unchanged.
 * Registered globally by `PaymentCoreModule`.
 */
@Injectable()
export class DomainErrorInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((error: unknown) => throwError(() => toHttp(error))));
  }
}

export function toHttp(error: unknown): unknown {
  if (!(error instanceof DomainError)) return error;
  const status = DOMAIN_ERROR_STATUS[error.code];
  if (status === undefined) return error;
  const details = error.details;
  return new HttpException(
    {
      message: error.message,
      code: error.code,
      ...(details !== undefined && { details }),
    },
    status,
    { cause: error },
  );
}
