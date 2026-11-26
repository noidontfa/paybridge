/**
 * The path-preserving proxy behind the BFF Route Handler (ADR 0004). A request
 * to the BFF prefix plus an API path goes to the API base URL plus the same
 * path, with method, query and body unchanged. The browser never sees the API
 * base URL and the API needs no CORS.
 *
 * Only `/internal/...` paths and the methods GET, HEAD, POST and DELETE are forwarded;
 * path segments that could climb out of that prefix are refused.
 *
 * Identity comes from the session, never from the browser: the access token
 * in the httpOnly cookie is forwarded as a bearer token, and the API derives
 * the acting User from it. When the access token has expired (its cookie is
 * gone) or the API refuses it, the proxy refreshes once with the refresh
 * cookie and retries. When that fails it answers 401 `SESSION_EXPIRED` and
 * clears the cookies, which sends the Console to the sign-in page. No token is
 * ever put in a response body, and upstream `set-cookie` is not passed back.
 */
import { refreshOnce } from './refresh-once';
import { ACCESS_COOKIE, ORGANIZATION_COOKIE, REFRESH_COOKIE, clearedSessionCookies, readCookie, sessionCookies, withCookies } from './session-cookies';
import type { FetchLike } from './auth-api';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'];

export interface ForwardOptions {
  /** The API base URL (server-side configuration). */
  baseUrl: string;
  /** Replaceable in tests. */
  fetch?: FetchLike;
  /** False in mock mode, where there is no API to sign in to. Default true. */
  authenticate?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'DELETE'];
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

function errorBody(status: number, error: string, code: string, message: string, request: Request) {
  return { statusCode: status, error, code, message, path: new URL(request.url).pathname, method: request.method, timestamp: new Date().toISOString() };
}

function refuse(status: number, error: string, code: string, message: string, request: Request): Response {
  return Response.json(errorBody(status, error, code, message, request), { status });
}

function sessionExpired(request: Request): Response {
  const response = Response.json(errorBody(401, 'Unauthorized', 'SESSION_EXPIRED', 'Your session has ended. Sign in again.', request), { status: 401 });
  return withCookies(response, clearedSessionCookies());
}

export async function forwardToApi(request: Request, path: string[], options: ForwardOptions): Promise<Response> {
  const incoming = new URL(request.url);
  const fetchImpl = options.fetch ?? fetch;
  const authenticate = options.authenticate ?? true;
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
  // Read once so a retry after a refresh can send it again.
  const body: ArrayBuffer | undefined = isRead(request.method) ? undefined : await request.arrayBuffer();

  let accessToken = authenticate ? readCookie(request, ACCESS_COOKIE) : undefined;
  const refreshToken = authenticate ? readCookie(request, REFRESH_COOKIE) : undefined;
  let newCookies: string[] = [];

  const refresh = async (): Promise<boolean> => {
    if (!refreshToken) return false;
    const result = await refreshOnce(options.baseUrl, refreshToken, options.fetch);
    if (!result.ok) return false;
    accessToken = result.session.accessToken;
    newCookies = sessionCookies(result.session);
    return true;
  };

  // A Super Admin's chosen Organization (or "all") rides along; the API
  // ignores it for everyone else. The browser's own header was not copied.
  const organization = authenticate ? readCookie(request, ORGANIZATION_COOKIE) : undefined;
  if (organization && (organization === 'all' || UUID.test(organization))) headers.set('x-organization-id', organization);

  if (authenticate && !accessToken && !(await refresh())) return sessionExpired(request);

  const send = async (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    if (authenticate && accessToken) requestHeaders.set('authorization', `Bearer ${accessToken}`);
    return fetchImpl(target, { method: request.method, headers: requestHeaders, body, cache: 'no-store' });
  };

  let upstream: Response;
  try {
    upstream = await send();
    if (authenticate && upstream.status === 401) {
      if (newCookies.length > 0 || !(await refresh())) return sessionExpired(request);
      upstream = await send();
      if (upstream.status === 401) return sessionExpired(request);
    }
  } catch {
    return Response.json(errorBody(502, 'Bad Gateway', 'API_UNREACHABLE', 'The Console server could not reach the API.', request), { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  return withCookies(response, newCookies);
}
