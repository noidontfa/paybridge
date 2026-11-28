/** How many of an endpoint's latest attempts must all fail before it is failing. */
export const FAILING_STREAK = 3;

/**
 * Whether a Webhook Endpoint keeps failing, from the outcomes of its latest
 * attempts, newest first (true = succeeded). It is failing when its latest
 * `FAILING_STREAK` attempts all failed; fewer attempts tell nothing yet.
 */
export function isFailing(latestOutcomes: readonly boolean[]): boolean {
  const latest = latestOutcomes.slice(0, FAILING_STREAK);
  return latest.length === FAILING_STREAK && latest.every((ok) => !ok);
}
