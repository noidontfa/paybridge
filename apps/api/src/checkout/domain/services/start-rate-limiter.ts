/** Who is starting a checkout Payment, as the rate limits count it. */
export interface StartCaller {
  readonly publishableKeyId: string;
  readonly clientIp: string;
}

/**
 * Limits how many checkout Payments are started per Publishable Key and per
 * client IP in a window. `consume` counts one start and throws
 * `CheckoutRateLimitedError` when either limit is exceeded.
 */
export abstract class StartRateLimiter {
  abstract consume(caller: StartCaller): Promise<void>;
}
