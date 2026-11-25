/**
 * The Console's session: two httpOnly cookies held by the BFF (ADR 0004,
 * ADR 0008). Browser scripts cannot read either, and no response body ever
 * carries a token.
 *
 * The access cookie expires together with the access token (5 minutes), so a
 * missing access cookie means "refresh now". The refresh cookie lives as long
 * as the refresh token (at most 7 days).
 */
export const ACCESS_COOKIE = 'pb_access';
export const REFRESH_COOKIE = 'pb_refresh';
/** A Super Admin's chosen Organization (an id, or `all`). Not a secret: the API checks who may use it. */
export const ORGANIZATION_COOKIE = 'pb_org';

/** The longest a refresh token lives (7 days), in seconds. */
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

function serialize(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const isSecure = () => process.env.NODE_ENV === 'production';

/** `Set-Cookie` values that store a session. */
export function sessionCookies(tokens: Tokens, secure = isSecure()): string[] {
  return [
    serialize(ACCESS_COOKIE, tokens.accessToken, Math.max(tokens.expiresIn, 1), secure),
    serialize(REFRESH_COOKIE, tokens.refreshToken, REFRESH_MAX_AGE_SECONDS, secure),
  ];
}

/** `Set-Cookie` values that delete the session. */
export function clearedSessionCookies(secure = isSecure()): string[] {
  return [serialize(ACCESS_COOKIE, '', 0, secure), serialize(REFRESH_COOKIE, '', 0, secure)];
}

export function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  return response;
}
