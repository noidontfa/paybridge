import { Inject, Injectable, Optional } from '@nestjs/common';

export interface RateLimitOptions {
  /** Most provider queries allowed in one window. */
  readonly max: number;
  readonly windowMs: number;
}

export const PROVIDER_QUERY_RATE_LIMIT = Symbol('PROVIDER_QUERY_RATE_LIMIT');

/** Time source and pause, replaceable in tests. */
export interface LimiterTiming {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const REAL_TIMING: LimiterTiming = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Sliding-window limiter for the provider queries the expiry worker makes
 * (spec: expiry sweep), so a burst of expiries stays under the configured
 * rate. `acquire()` returns when the caller may query; callers are served in
 * order. The limit is per process.
 */
@Injectable()
export class ProviderQueryRateLimiter {
  private readonly starts: number[] = [];
  private tail: Promise<void> = Promise.resolve();
  private readonly timing: LimiterTiming;

  constructor(
    @Inject(PROVIDER_QUERY_RATE_LIMIT)
    private readonly options: RateLimitOptions,
    @Optional() timing?: LimiterTiming,
  ) {
    this.timing = timing ?? REAL_TIMING;
  }

  acquire(): Promise<void> {
    const turn = this.tail.then(() => this.waitForRoom());
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  private async waitForRoom(): Promise<void> {
    const { max, windowMs } = this.options;
    for (;;) {
      const now = this.timing.now();
      while (this.starts.length > 0 && now - this.starts[0]! >= windowMs) {
        this.starts.shift();
      }
      if (this.starts.length < max) {
        this.starts.push(now);
        return;
      }
      await this.timing.sleep(this.starts[0]! + windowMs - now);
    }
  }
}
