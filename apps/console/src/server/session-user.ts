import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnvironment } from '@/lib/environment';
import type { Operator } from '@/lib/operator';
import { apiMe } from './auth-api';
import { getCurrentOperator } from './current-operator';
import { ACCESS_COOKIE } from './session-cookies';

/**
 * The signed-in User for the root layout, or null when nobody is signed in
 * (the sign-in page). Mock mode has no sign-in: it shows the configured
 * identity (`CONSOLE_OPERATOR_ID`, `CONSOLE_OPERATOR_NAME`).
 *
 * The access token is checked by the API. When it refuses it (revoked, or
 * expired a moment ago) the browser is sent through `/api/auth/refresh`, which
 * ends at sign-in when the refresh token is no good either.
 */
export async function getSessionOperator(): Promise<Operator | null> {
  const { apiBaseUrl, mockMode } = getEnvironment();
  if (mockMode) return getCurrentOperator();
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!accessToken) return null;
  const user = await apiMe(apiBaseUrl, accessToken);
  if (!user) redirect('/api/auth/refresh?next=/');
  return { id: user.id, name: user.name, role: user.role, organization: user.organization?.name ?? null, permissions: user.permissions };
}
