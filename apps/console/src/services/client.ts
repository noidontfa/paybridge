/**
 * API client: one typed function per endpoint. Each calls the Console's BFF,
 * parses the response with its copied Zod schema, and turns every failure into
 * an `ApiError`.
 *
 * Extension point: add an endpoint in its feature's `api.ts`: write the schema
 * there and a function that calls `request(path, schema, init?)` from this
 * module. Build the path with `INTERNAL` for operator routes.
 */
import type { z } from 'zod';
import { BFF_PREFIX } from '@/services/bff';
import { ApiError, CLIENT_ERROR_CODES, apiErrorBodySchema } from './errors';

/** Operator routes live under the API's internal prefix. */
export const INTERNAL = '/internal';

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

function bffUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BFF_PREFIX}${path}`, globalThis.location?.href ?? 'http://localhost');
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function toApiError(response: Response): Promise<ApiError> {
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => undefined));
  if (parsed.success) {
    const { message, code, details } = parsed.data;
    return new ApiError({
      status: response.status,
      code: code ?? CLIENT_ERROR_CODES.unknown,
      message: Array.isArray(message) ? message.join('; ') : message,
      details,
    });
  }
  return new ApiError({
    status: response.status,
    code: CLIENT_ERROR_CODES.unknown,
    message: `The API answered ${response.status} ${response.statusText}`.trim(),
  });
}

export async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(bffUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: CLIENT_ERROR_CODES.network,
      message: 'Could not reach the Console server.',
      details: cause,
    });
  }
  if (!response.ok) {
    const error = await toApiError(response);
    // The session has ended (the BFF cleared its cookies): back to sign-in.
    if (error.status === 401 && error.code === 'SESSION_EXPIRED' && typeof window !== 'undefined') {
      window.location.assign('/sign-in');
    }
    throw error;
  }

  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: CLIENT_ERROR_CODES.invalidResponse,
      message: `The API response for ${path} did not match the expected shape.`,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}
