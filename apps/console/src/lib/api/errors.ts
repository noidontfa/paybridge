/** Codes the Console itself assigns when no API error code exists. */
export const CLIENT_ERROR_CODES = {
  network: 'NETWORK_ERROR',
  invalidResponse: 'INVALID_RESPONSE',
  unknown: 'UNKNOWN_ERROR',
} as const;

/**
 * The one error the API client throws. `code` and `message` are the API's
 * (`PAYMENT_NOT_FOUND`, ...) when it sent an error envelope, otherwise one of
 * `CLIENT_ERROR_CODES`. `status` is the HTTP status, or 0 when none arrived.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(init: { status: number; code: string; message: string; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
