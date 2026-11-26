/**
 * Refreshing a session, once per refresh token. A refresh token can be used a
 * single time (the API treats a second use as theft and revokes the whole
 * sign-in), but the browser sends several requests at once and the first
 * answer's new cookies may not be applied yet when the next one arrives. So
 * concurrent and near-simultaneous refreshes with the same token share one
 * call to the API and its result.
 *
 * Held in this server process only: a Console running on several instances
 * needs sticky routing, or a shared store, before relying on it.
 */
import { apiRefresh, type FetchLike, type SessionResult } from './auth-api';

/** How long the result of a refresh answers requests that still carry the old token. */
const SHARE_MS = 30_000;

const inFlight = new Map<string, Promise<SessionResult>>();

export function refreshOnce(baseUrl: string, refreshToken: string, fetchImpl?: FetchLike): Promise<SessionResult> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;
  const attempt = apiRefresh(baseUrl, refreshToken, fetchImpl);
  inFlight.set(refreshToken, attempt);
  setTimeout(() => inFlight.delete(refreshToken), SHARE_MS).unref?.();
  return attempt;
}
