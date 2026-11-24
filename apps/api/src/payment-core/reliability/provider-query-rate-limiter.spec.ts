import {
  ProviderQueryRateLimiter,
  type RateLimitOptions,
} from './provider-query-rate-limiter.js';

function setup(options: RateLimitOptions) {
  let time = 0;
  const waits: number[] = [];
  const limiter = new ProviderQueryRateLimiter(options, {
    now: () => time,
    sleep: (ms) => {
      waits.push(ms);
      time += ms;
      return Promise.resolve();
    },
  });
  return { limiter, waits, at: () => time };
}

describe('ProviderQueryRateLimiter', () => {
  it('lets a burst up to the limit through without waiting', async () => {
    const { limiter, waits } = setup({ max: 3, windowMs: 1000 });
    for (let i = 0; i < 3; i++) await limiter.acquire();
    expect(waits).toEqual([]);
  });

  it('holds the next call until the window has room', async () => {
    const { limiter, waits, at } = setup({ max: 2, windowMs: 1000 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(waits).toEqual([1000]);
    expect(at()).toBe(1000);
  });

  it('never allows more than max calls in any window', async () => {
    const { limiter, at } = setup({ max: 5, windowMs: 1000 });
    const starts: number[] = [];
    for (let i = 0; i < 23; i++) {
      await limiter.acquire();
      starts.push(at());
    }
    for (const start of starts) {
      const inWindow = starts.filter((t) => t >= start && t < start + 1000);
      expect(inWindow.length).toBeLessThanOrEqual(5);
    }
    // 23 calls at 5 per second need at least 4 full seconds.
    expect(at()).toBeGreaterThanOrEqual(4000);
  });

  it('serialises concurrent callers', async () => {
    const { limiter, at } = setup({ max: 1, windowMs: 100 });
    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);
    expect(at()).toBe(200);
  });
});
