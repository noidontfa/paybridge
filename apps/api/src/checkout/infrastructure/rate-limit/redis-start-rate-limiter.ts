import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  CheckoutRateLimitedError,
  type RateLimitScope,
} from '../../domain/errors.js';
import { CheckoutClock } from '../../domain/services/clock.js';
import {
  StartRateLimiter,
  type StartCaller,
} from '../../domain/services/start-rate-limiter.js';

/** The configured limits (`CHECKOUT_START_RATE_LIMIT_*`). */
export interface StartRateLimitOptions {
  readonly perPublishableKey: number;
  readonly perClientIp: number;
  readonly windowSeconds: number;
  readonly redisUrl: string;
  /** Prefix of every key, so deployments and test databases stay apart. */
  readonly keyPrefix: string;
}

export const START_RATE_LIMIT_OPTIONS = Symbol('START_RATE_LIMIT_OPTIONS');

/**
 * Fixed-window counters in Redis, shared by every API instance: one counter
 * per Publishable Key and one per client IP for each window of the checkout
 * clock. If Redis cannot be reached the start is let through (logged), so an
 * outage of the limiter never stops sales.
 */
@Injectable()
export class RedisStartRateLimiter
  extends StartRateLimiter
  implements OnModuleDestroy
{
  private readonly logger = new Logger(RedisStartRateLimiter.name);
  private readonly redis: Redis;

  constructor(
    @Inject(START_RATE_LIMIT_OPTIONS)
    private readonly options: StartRateLimitOptions,
    @Inject(CheckoutClock) private readonly clock: CheckoutClock,
  ) {
    super();
    this.redis = new Redis(options.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
    });
  }

  async consume(caller: StartCaller): Promise<void> {
    const { windowSeconds } = this.options;
    const windowMs = windowSeconds * 1000;
    const now = this.clock.now().getTime();
    const window = Math.floor(now / windowMs);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(((window + 1) * windowMs - now) / 1000),
    );
    const checks: [RateLimitScope, string, number][] = [
      ['PUBLISHABLE_KEY', caller.publishableKeyId, this.options.perPublishableKey],
      ['CLIENT_IP', caller.clientIp, this.options.perClientIp],
    ];
    let counts: number[];
    try {
      const multi = this.redis.multi();
      for (const [scope, id] of checks) {
        const key = `${this.options.keyPrefix}:checkout-starts:${scope}:${id}:${window}`;
        multi.incr(key).expire(key, windowSeconds + 1);
      }
      const results = (await multi.exec()) ?? [];
      counts = checks.map((_, i) => Number(results[i * 2]?.[1] ?? 0));
    } catch (error) {
      this.logger.warn(`Checkout rate limit not checked: ${String(error)}`);
      return;
    }
    checks.forEach(([scope, , limit], i) => {
      if (counts[i]! > limit) {
        throw new CheckoutRateLimitedError(scope, retryAfterSeconds);
      }
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
