// Retry schedule of a Webhook delivery (spec: Webhook Endpoint and delivery,
// Retries): exponential backoff with jitter over about three days.

const MINUTE_MS = 60_000;

/** Attempts of one delivery in all, the first one included. */
export const WEBHOOK_MAX_ATTEMPTS = 12;
/** The wait after the first failure; each further one is 3 times longer… */
const FIRST_DELAY_MS = MINUTE_MS;
const GROWTH = 3;
/** …up to this cap. */
const MAX_DELAY_MS = 12 * 60 * MINUTE_MS;
/** Each wait is stretched or shrunk by up to this share. */
const JITTER = 0.2;

/**
 * How long to wait before the next attempt, after `failedAttempts` attempts
 * have failed; null when that was the last attempt and the delivery fails.
 * `random` is uniform in [0, 1) and picks the jitter.
 *
 * Without jitter: 1, 3, 9, 27, 81 and 243 minutes, then 12 hours five times,
 * 66 hours in all between the first and the last attempt.
 */
export function retryDelayMs(
  failedAttempts: number,
  random: number,
): number | null {
  if (!Number.isInteger(failedAttempts) || failedAttempts < 1) {
    throw new RangeError(`failedAttempts must be 1 or more: ${failedAttempts}`);
  }
  if (failedAttempts >= WEBHOOK_MAX_ATTEMPTS) return null;
  const base = Math.min(
    FIRST_DELAY_MS * GROWTH ** (failedAttempts - 1),
    MAX_DELAY_MS,
  );
  return Math.round(base * (1 - JITTER + 2 * JITTER * random));
}
