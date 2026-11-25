/**
 * The path-preserving proxy behind the BFF Route Handler (ADR 0004). A request
 * to the BFF prefix plus an API path goes to the API base URL plus the same
 * path, with method, query and body unchanged. The browser never sees the API
 * base URL and the API needs no CORS.
 *
 * Only `/internal/...` paths and the methods GET, HEAD and POST are forwarded;
 * path segments that could climb out of that prefix are refused.
 *
 * Every write (any method other than GET and HEAD) gets its identity here,
 * never from the browser: `actor` of a JSON object body is overwritten from
 * the auth seam (`./current-operator.ts`). Upstream `set-cookie` is not passed
 * back to the browser.
 */
import { getCurrentOperator } from './current-operator';
import type { Operator } from '@/lib/operator';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'];

export interface ForwardOptions {
  /** The API base URL (server-side configuration). */
  baseUrl: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  /** The current Operator (the auth seam). Replaceable in tests. */
  operator?: () => Operator;
}

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST'];
const FORWARDED_PREFIX = 'internal';

const isRead = (method: string) => method === 'GET' || method === 'HEAD';

/** A segment that is, or decodes to, `.`/`..`, or carries a path separator. */
function isUnsafeSegment(segment: string): boolean {
  let value = segment;
  for (let i = 0; i < 3; i++) {
    if (/^\.{1,2}$/.test(value) || /[\\/]/.test(value)) return true;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) return false;
      value = decoded;
    } catch {
      return true;
    }
  }
  return true;
}

function refuse(status: number, error: string, code: string, message: string, request: Request): Response {
  return Response.json(
    { statusCode: status, error, code, message, path: new URL(request.url).pathname, method: request.method, timestamp: new Date().toISOString() },
    { status },
  );
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
  if (!ALLOWED_METHODS.includes(request.method)) {
    return refuse(405, 'Method Not Allowed', 'BFF_METHOD_NOT_ALLOWED', `The Console does not forward ${request.method}.`, request);
  }
  if (path.some(isUnsafeSegment)) {
    return refuse(400, 'Bad Request', 'BFF_INVALID_PATH', 'The path contains an unsafe segment.', request);
  }
  if (path[0] !== FORWARDED_PREFIX || path.length < 2) {
    return refuse(404, 'Not Found', 'BFF_PATH_NOT_FORWARDED', 'Only /internal paths are forwarded.', request);
  }
  const target = `${options.baseUrl.replace(/\/$/, '')}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = !isRead(request.method);

  let body: ArrayBuffer | undefined = hasBody ? await request.arrayBuffer() : undefined;
  if (body) body = withActor(body, (options.operator ?? getCurrentOperator)());

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
