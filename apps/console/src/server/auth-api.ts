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
