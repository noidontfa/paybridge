/**
 * The path-preserving proxy behind the BFF Route Handler (ADR 0004). A request
 * to the BFF prefix plus an API path goes to the API base URL plus the same
 * path, with method, query and body unchanged. The browser never sees the API
 * base URL and the API needs no CORS.
 *
 * Operator write calls get their identity here, never from the browser: the
 * `actor` of a review-resolution body is set from the auth seam
 * (`./current-operator.ts`), replacing anything the browser sent. Add other
 * operator writes to `isOperatorWrite` the same way.
 */
import { getCurrentOperator } from './current-operator';
import type { Operator } from '@/lib/operator';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

export interface ForwardOptions {
  /** The API base URL (server-side configuration). */
  baseUrl: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  /** The current Operator (the auth seam). Replaceable in tests. */
  operator?: () => Operator;
}

/** `POST internal/payments/:id/review-resolution` */
function isReviewResolution(method: string, path: string[]): boolean {
  return method === 'POST' && path.length === 4 && path[0] === 'internal' && path[1] === 'payments' && path[3] === 'review-resolution';
}

/** The body with `actor` set to the Operator; a body that is not a JSON object goes through for the API to reject. */
function withActor(body: ArrayBuffer, operator: Operator): ArrayBuffer {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
    return new TextEncoder().encode(JSON.stringify({ ...parsed, actor: operator.id })).buffer as ArrayBuffer;
  } catch {
    return body;
  }
}

export async function forwardToApi(request: Request, path: string[], options: ForwardOptions): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${options.baseUrl.replace(/\/$/, '')}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let body: ArrayBuffer | undefined = hasBody ? await request.arrayBuffer() : undefined;
  if (body && isReviewResolution(request.method, path)) body = withActor(body, (options.operator ?? getCurrentOperator)());

  let upstream: Response;
  try {
    upstream = await (options.fetch ?? fetch)(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        statusCode: 502,
        error: 'Bad Gateway',
        code: 'API_UNREACHABLE',
        message: 'The Console server could not reach the API.',
        path: incoming.pathname,
        method: request.method,
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}
