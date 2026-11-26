/**
 * The Console's own sign-in, sign-out and refresh endpoints (`/api/auth/...`).
 * They call the API from the server and keep the tokens in httpOnly cookies;
 * what the browser gets back is the signed-in User, never a token.
 */
import {
  apiAcceptInvitation,
  apiChangePassword,
  apiCompletePasswordReset,
  apiRequestPasswordReset,
  apiSignIn,
  apiSignOut,
  type FetchLike,
  type PlainResult,
  type SessionUser,
} from './auth-api';
import { refreshOnce } from './refresh-once';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearedSessionCookies, readCookie, sessionCookies, withCookies } from './session-cookies';

export interface AuthOptions {
  baseUrl: string;
  fetch?: FetchLike;
}

/** The sign-in page. */
export const SIGN_IN_PATH = '/sign-in';

function badRequest(request: Request, message: string): Response {
  return Response.json(
    { statusCode: 400, error: 'Bad Request', code: 'BAD_REQUEST', message, path: new URL(request.url).pathname, method: request.method, timestamp: new Date().toISOString() },
    { status: 400 },
  );
}

/** `POST /api/auth/sign-in` with `{ email, password }`: answers `{ user }` and sets the cookies. */
export async function handleSignIn(request: Request, options: AuthOptions): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') return badRequest(request, 'Email and password are required.');

  let result;
  try {
    result = await apiSignIn(options.baseUrl, { email, password }, options.fetch);
  } catch {
    return Response.json(
      { statusCode: 502, error: 'Bad Gateway', code: 'API_UNREACHABLE', message: 'The Console server could not reach the API.', path: new URL(request.url).pathname, method: request.method, timestamp: new Date().toISOString() },
      { status: 502 },
    );
  }
  // A refusal carries the API's error envelope (code and message) and no token.
  if (!result.ok) return Response.json(result.body ?? { statusCode: result.status }, { status: result.status });
  const user: SessionUser = result.session.user;
  return withCookies(Response.json({ user }), sessionCookies(result.session));
}

/** `POST /api/auth/sign-out`: revokes the refresh token and clears the cookies. */
export async function handleSignOut(request: Request, options: AuthOptions): Promise<Response> {
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  if (refreshToken) await apiSignOut(options.baseUrl, refreshToken, options.fetch);
  return withCookies(Response.json({ ok: true }), clearedSessionCookies());
}

/** A redirect whose headers can still be extended (`Response.redirect` is immutable). */
function redirectTo(target: URL): Response {
  return new Response(null, { status: 307, headers: { location: target.toString() } });
}

/** Only a path on this site: `/payments?x=1`, never `//evil.test` or `https://...`. */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

/**
 * `GET /api/auth/refresh?next=/path`: for page navigations whose access cookie
 * has expired. Refreshes, sets the cookies and sends the browser back to
 * `next`; when the refresh fails, clears the cookies and sends it to sign-in.
 */
export async function handleRefreshRedirect(request: Request, options: AuthOptions): Promise<Response> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  const result = refreshToken ? await refreshOnce(options.baseUrl, refreshToken, options.fetch) : undefined;
  if (result?.ok) {
    return withCookies(redirectTo(new URL(next, url.origin)), sessionCookies(result.session));
  }
  return withCookies(redirectTo(new URL(SIGN_IN_PATH, url.origin)), clearedSessionCookies());
}

function unreachable(request: Request): Response {
  return Response.json(
    { statusCode: 502, error: 'Bad Gateway', code: 'API_UNREACHABLE', message: 'The Console server could not reach the API.', path: new URL(request.url).pathname, method: request.method, timestamp: new Date().toISOString() },
    { status: 502 },
  );
}

/** Passes the API's answer on: no body for 204, otherwise its JSON (error envelopes included). */
function relay(result: PlainResult): Response {
  if (result.status === 204) return new Response(null, { status: 204 });
  return Response.json(result.body ?? {}, { status: result.status });
}

/**
 * `POST /api/auth/forgot-password` with `{ email }`. The API answers the same
 * for every address; so does this.
 */
export async function handleForgotPassword(request: Request, options: AuthOptions): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const { email } = (body ?? {}) as { email?: unknown };
  if (typeof email !== 'string' || email.trim() === '') return badRequest(request, 'An email is required.');
  try {
    return relay(await apiRequestPasswordReset(options.baseUrl, email, options.fetch));
  } catch {
    return unreachable(request);
  }
}

/** `POST /api/auth/reset-password` with `{ token, password }`. */
export async function handleResetPassword(request: Request, options: AuthOptions): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const { token, password } = (body ?? {}) as { token?: unknown; password?: unknown };
  if (typeof token !== 'string' || typeof password !== 'string') return badRequest(request, 'A token and a password are required.');
  try {
    return relay(await apiCompletePasswordReset(options.baseUrl, { token, password }, options.fetch));
  } catch {
    return unreachable(request);
  }
}

/** `POST /api/auth/accept-invitation` with `{ token, name, password }`. */
export async function handleAcceptInvitation(request: Request, options: AuthOptions): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const { token, name, password } = (body ?? {}) as { token?: unknown; name?: unknown; password?: unknown };
  if (typeof token !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return badRequest(request, 'A token, a name and a password are required.');
  }
  try {
    return relay(await apiAcceptInvitation(options.baseUrl, { token, name, password }, options.fetch));
  } catch {
    return unreachable(request);
  }
}

/**
 * `POST /api/auth/change-password` with `{ currentPassword, newPassword }`.
 * The refresh token is an httpOnly cookie, so the browser cannot name its own
 * session: the server adds it, which keeps this sign-in and ends the others.
 * An expired access token is refreshed first (the refresh rotates the token).
 */
export async function handleChangePassword(request: Request, options: AuthOptions): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const { currentPassword, newPassword } = (body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return badRequest(request, 'The current and the new password are required.');
  }

  let accessToken = readCookie(request, ACCESS_COOKIE);
  let refreshToken = readCookie(request, REFRESH_COOKIE);
  let newCookies: string[] = [];
  if (!accessToken && refreshToken) {
    const refreshed = await refreshOnce(options.baseUrl, refreshToken, options.fetch);
    if (refreshed.ok) {
      accessToken = refreshed.session.accessToken;
      refreshToken = refreshed.session.refreshToken;
      newCookies = sessionCookies(refreshed.session);
    }
  }
  const expired = () =>
    withCookies(
      Response.json(
        { statusCode: 401, error: 'Unauthorized', code: 'SESSION_EXPIRED', message: 'Your session has ended. Sign in again.', path: new URL(request.url).pathname, method: request.method, timestamp: new Date().toISOString() },
        { status: 401 },
      ),
      clearedSessionCookies(),
    );
  if (!accessToken) return expired();

  let result: PlainResult;
  try {
    result = await apiChangePassword(options.baseUrl, accessToken, { currentPassword, newPassword, ...(refreshToken && { refreshToken }) }, options.fetch);
  } catch {
    return unreachable(request);
  }
  if (result.status === 401) return expired();
  return withCookies(relay(result), newCookies);
}
