/**
 * The BFF's calls to the API's sign-in endpoints (`/internal/auth/...`).
 * Only the BFF makes them: the tokens in their answers stay on the server.
 */
import type { Tokens } from './session-cookies';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ORGANIZATION_ADMIN' | 'OPERATOR';
  organization: { id: string; name: string } | null;
  permissions: string[];
}

export interface ApiSession extends Tokens {
  user: SessionUser;
}

export type FetchLike = typeof fetch;

const join = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

async function post(baseUrl: string, path: string, body: unknown, fetchImpl: FetchLike): Promise<Response> {
  return fetchImpl(join(baseUrl, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/** The API's answer: a session, or the status and error body it refused with. */
export type SessionResult = { ok: true; session: ApiSession } | { ok: false; status: number; body: unknown };

async function toResult(response: Response): Promise<SessionResult> {
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { ok: true, session: body as ApiSession };
  return { ok: false, status: response.status, body };
}

export async function apiSignIn(
  baseUrl: string,
  credentials: { email: string; password: string },
  fetchImpl: FetchLike = fetch,
): Promise<SessionResult> {
  return toResult(await post(baseUrl, '/internal/auth/sign-in', credentials, fetchImpl));
}

export async function apiRefresh(baseUrl: string, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<SessionResult> {
  try {
    return toResult(await post(baseUrl, '/internal/auth/refresh', { refreshToken }, fetchImpl));
  } catch {
    return { ok: false, status: 0, body: undefined };
  }
}

export async function apiSignOut(baseUrl: string, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    await post(baseUrl, '/internal/auth/sign-out', { refreshToken }, fetchImpl);
  } catch {
    // The cookies are cleared either way; the refresh token expires on its own.
  }
}

/** The signed-in User for an access token, or null when the API refuses it. */
export async function apiMe(baseUrl: string, accessToken: string, fetchImpl: FetchLike = fetch): Promise<SessionUser | null> {
  try {
    const response = await fetchImpl(join(baseUrl, '/internal/auth/me'), {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    return response.ok ? ((await response.json()) as SessionUser) : null;
  } catch {
    return null;
  }
}

/** The API's plain answer (status and error body) for calls that carry no session. */
export interface PlainResult {
  status: number;
  body: unknown;
}

async function toPlain(response: Response): Promise<PlainResult> {
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

export async function apiRequestPasswordReset(baseUrl: string, email: string, fetchImpl: FetchLike = fetch): Promise<PlainResult> {
  return toPlain(await post(baseUrl, '/internal/auth/password-reset/request', { email }, fetchImpl));
}

export async function apiCompletePasswordReset(
  baseUrl: string,
  input: { token: string; password: string },
  fetchImpl: FetchLike = fetch,
): Promise<PlainResult> {
  return toPlain(await post(baseUrl, '/internal/auth/password-reset/complete', input, fetchImpl));
}

export async function apiAcceptInvitation(
  baseUrl: string,
  input: { token: string; name: string; password: string },
  fetchImpl: FetchLike = fetch,
): Promise<PlainResult> {
  return toPlain(await post(baseUrl, '/internal/auth/invitations/accept', input, fetchImpl));
}

export async function apiChangePassword(
  baseUrl: string,
  accessToken: string,
  input: { currentPassword: string; newPassword: string; refreshToken?: string },
  fetchImpl: FetchLike = fetch,
): Promise<PlainResult> {
  const response = await fetchImpl(join(baseUrl, '/internal/auth/change-password'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  return toPlain(response);
}
