import { retryDelayMs, WEBHOOK_MAX_ATTEMPTS } from './backoff.js';

// The schedule as documented: after a failed attempt, wait 1 min, 3 min,
// 9 min, 27 min, 81 min, 243 min, then 12 h for each further retry, each
// stretched or shrunk by up to 20% of jitter. 12 attempts in all.

const MIN = 60_000;
const HOUR = 60 * MIN;
const MIDDLE = 0.5; // no jitter

describe('webhook retry backoff', () => {
  it('waits longer after each failure, up to a 12 hour cap', () => {
    const delays = Array.from({ length: WEBHOOK_MAX_ATTEMPTS - 1 }, (_, i) =>
      retryDelayMs(i + 1, MIDDLE),
    );

    expect(delays).toEqual([
      1 * MIN,
      3 * MIN,
      9 * MIN,
      27 * MIN,
      81 * MIN,
      243 * MIN,
      12 * HOUR,
      12 * HOUR,
      12 * HOUR,
      12 * HOUR,
      12 * HOUR,
    ]);
  });

  it('makes 12 attempts in all: none is scheduled after the last one fails', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(12);
    expect(retryDelayMs(11, MIDDLE)).not.toBeNull();
    expect(retryDelayMs(12, MIDDLE)).toBeNull();
    expect(retryDelayMs(13, MIDDLE)).toBeNull();
  });

  it('spreads retries by up to 20% either way so receivers are not hit in bursts', () => {
    expect(retryDelayMs(1, 0)).toBe(48_000);
    expect(retryDelayMs(1, 1)).toBe(72_000);
    expect(retryDelayMs(7, 0)).toBe(9.6 * HOUR);
    expect(retryDelayMs(7, 0.75)).toBe(13.2 * HOUR);
  });

  it('spans about three days from the first failure to the last attempt', () => {
    const total = (random: number) =>
      Array.from({ length: WEBHOOK_MAX_ATTEMPTS - 1 }, (_, i) =>
        retryDelayMs(i + 1, random),
      ).reduce<number>((sum, d) => sum + d!, 0);

    // 66 h 4 min without jitter; between 2.2 and 3.3 days at the extremes.
    expect(total(MIDDLE)).toBe(66 * HOUR + 4 * MIN);
    expect(total(0)).toBeGreaterThan(2.2 * 24 * HOUR);
    expect(total(1)).toBeLessThan(3.4 * 24 * HOUR);
  });

  it('rejects an attempt count below one', () => {
    expect(() => retryDelayMs(0, MIDDLE)).toThrow(RangeError);
  });
});
