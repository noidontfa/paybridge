import {
  HttpException,
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type HttpStatus,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, type Observable } from 'rxjs';

// One way for every module's controllers to turn their domain errors into
// HTTP answers: a table of rules, applied by an interceptor. The answer body
// is `{ message, code, details? }`, which the global exception filter puts in
// the standard error envelope. Errors no rule names pass through unchanged.
// (Payment Core's global `DomainErrorInterceptor` maps Core's coded errors
// the same way, from `DOMAIN_ERROR_STATUS`.)

type ErrorClass<E extends Error> = abstract new (...args: never[]) => E;

export interface ErrorRule<E extends Error = Error> {
  readonly error: ErrorClass<E>;
  readonly status: HttpStatus;
  /** The machine-readable code: fixed, or read from the error. */
  readonly code: string | ((error: E) => string);
  readonly details?: (error: E) => Record<string, unknown>;
  /** Response headers the answer carries (e.g. `Retry-After`). */
  readonly headers?: (error: E) => Record<string, string>;
}

/** A rule, typed by its error class. */
export const errorRule = <E extends Error>(rule: ErrorRule<E>): ErrorRule =>
  rule as unknown as ErrorRule;

/** The first rule for the error (rules are tried in order), if any. */
function ruleFor(
  rules: readonly ErrorRule[],
  error: unknown,
): ErrorRule | undefined {
  return error instanceof Error
    ? rules.find((rule) => error instanceof rule.error)
    : undefined;
}

/** The HTTP answer for `error`, or `error` itself when no rule names it. */
export function httpErrorFor(
  rules: readonly ErrorRule[],
  error: unknown,
): unknown {
  const rule = ruleFor(rules, error);
  if (!rule) return error;
  const e = error as Error;
  const details = rule.details?.(e);
  return new HttpException(
    {
      message: e.message,
      code: typeof rule.code === 'string' ? rule.code : rule.code(e),
      ...(details !== undefined && { details }),
    },
    rule.status,
    { cause: e },
  );
}

@Injectable()
class ErrorMappingInterceptor implements NestInterceptor {
  constructor(private readonly rules: readonly ErrorRule[]) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const headers = ruleFor(this.rules, error)?.headers?.(error as Error);
        if (headers) {
          const response = context
            .switchToHttp()
            .getResponse<{ setHeader(name: string, value: string): void }>();
          for (const [name, value] of Object.entries(headers)) {
            response.setHeader(name, value);
          }
        }
        throw httpErrorFor(this.rules, error);
      }),
    );
  }
}

/** Maps the errors a controller's handlers throw, by `rules`. */
export const MapErrors = (rules: readonly ErrorRule[]) =>
  UseInterceptors(new ErrorMappingInterceptor(rules));
