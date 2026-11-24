import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '../../generated/prisma/client.js';
import type { ErrorResponseDto } from './error-response.dto.js';

interface NormalizedError {
  status: number;
  message: string | string[];
  /** Stable machine-readable code, when the exception body carries one. */
  code?: string;
  /** Machine-readable fields, when the exception body carries them. */
  details?: Record<string, unknown>;
}

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * Last line of defence: converts *every* thrown value into the same JSON
 * envelope (see ErrorResponseDto) and logs it with the right severity.
 *
 * - HttpException (incl. validation errors)   -> its own status / message
 * - Prisma known request errors               -> mapped to 4xx where meaningful
 * - http-errors from the body parser (400/413)-> their own status
 * - anything else                             -> 500, details hidden from the client
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const { status, message, code, details } = this.normalize(exception);

    const body: ErrorResponseDto = {
      statusCode: status,
      error: HttpStatus[status]
        ? toTitleCase(HttpStatus[status])
        : 'Unknown Error',
      message,
      ...(code !== undefined && { code }),
      ...(details !== undefined && { details }),
      path: httpAdapter.getRequestUrl(request),
      method: httpAdapter.getRequestMethod(request),
      timestamp: new Date().toISOString(),
      requestId: request?.id ? String(request.id) : undefined,
    };

    this.log(exception, status, body);
    httpAdapter.reply(response, body, status);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { status: exception.getStatus(), message: res };
      }
      const { message, code, details } = res as {
        message?: string | string[];
        code?: unknown;
        details?: unknown;
      };
      return {
        status: exception.getStatus(),
        message: message ?? exception.message,
        ...(typeof code === 'string' && { code }),
        ...(isRecord(details) && { details }),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            message: 'A record with the same unique value already exists',
          };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            message: 'The operation violates a relation constraint',
          };
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            message: 'The requested record was not found',
          };
        case 'P2000':
          return {
            status: HttpStatus.BAD_REQUEST,
            message: 'A provided value is too long for its column',
          };
      }
    }

    // Errors raised by express middleware (malformed JSON, payload too large, ...)
    if (isClientHttpError(exception)) {
      return { status: exception.status, message: exception.message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }

  private log(
    exception: unknown,
    status: number,
    body: ErrorResponseDto,
  ): void {
    const summary = `${body.method} ${body.path} -> ${status}`;
    if (status >= 500) {
      this.logger.error(
        summary,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${summary} ${JSON.stringify(body.message)}`);
    }
  }
}

function isClientHttpError(
  value: unknown,
): value is { status: number; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { status, message } = value as Record<string, unknown>;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof message === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** BAD_REQUEST -> "Bad Request" */
function toTitleCase(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
