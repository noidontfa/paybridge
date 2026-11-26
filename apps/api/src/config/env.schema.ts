import { z } from 'zod';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

/** An empty value (`KEY=` in a .env file) counts as unset. */
const optionalKey = (prefixes: readonly string[], label: string) =>
  z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => prefixes.some((p) => v.startsWith(p)), {
        message: `must start with ${label}`,
      })
      .optional(),
  );

const STRIPE_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
] as const;

const stripeMode = (key: string): 'test' | 'live' | undefined =>
  key.includes('_test_') ? 'test' : key.includes('_live_') ? 'live' : undefined;

const envObject = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  /**
   * Public origin of this API, as the payment providers reach it. The Console
   * shows `<PUBLIC_BASE_URL>/api/webhooks/<gatewayId>` as each gateway's
   * Callback URL. Unset => `http://localhost:<PORT>`.
   */
  PUBLIC_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => /^https?:\/\/[^\s/]+/.test(v) && URL.canParse(v), {
        message: 'must be an http(s) URL',
      })
      .optional(),
  ),
  /**
   * Public origin of the Console, used to build the links in emails (Password
   * Reset). Unset => `http://localhost:8888`.
   */
  CONSOLE_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => /^https?:\/\/[^\s/]+/.test(v) && URL.canParse(v), {
        message: 'must be an http(s) URL',
      })
      .default('http://localhost:8888'),
  ),
  /** Swagger UI toggle. Unset => enabled everywhere except production. */
  SWAGGER_ENABLED: z.stringbool().optional(),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL connection string'),
  /** BullMQ connection (dispatch only; PostgreSQL is the source of truth). */
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'must be a Redis connection string'),
  /** Prefix of every BullMQ key in Redis. BullMQ forbids `:` in it. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, _ and - only')
    .default('paybridge'),
  /** Most Payments the expiry sweep queues per run (it runs every minute). */
  EXPIRY_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  /** Most provider queries per second the expiry worker makes. */
  EXPIRY_QUERY_RATE_PER_SECOND: z.coerce.number().int().min(1).default(5),
  /** Outbox relay poll loop. Unset => enabled everywhere except test. */
  OUTBOX_RELAY_ENABLED: z.stringbool().optional(),
  /** Pause between outbox relay polls, in milliseconds. */
  OUTBOX_RELAY_POLL_INTERVAL_MS: z.coerce.number().int().min(10).default(1000),
  /** Outbox rows read per query by the relay. */
  OUTBOX_RELAY_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100),
  /**
   * ES256 signing key of access tokens: a PKCS#8 PEM (P-256), newlines may be
   * written as `\n`. Unset => a fresh key per process (development and tests
   * only: restarting then signs everyone out). Production refuses to start
   * without it.
   */
  AUTH_JWT_PRIVATE_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /**
   * Rotation: public keys (SPKI PEM, `\n` for newlines, comma separated) of
   * earlier signing keys. They stay in the published JWKS and verify tokens
   * signed before the rotation, so nobody is signed out. Drop a key once the
   * access-token lifetime has passed.
   */
  AUTH_JWT_RETIRED_PUBLIC_KEYS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /**
   * Keys that encrypt Gateway Connection credentials: `id:base64key` pairs
   * separated by commas, each key 32 random bytes; the first encrypts, all
   * decrypt. Unset => a fixed development key (never in production, which
   * refuses to start without it).
   */
  GATEWAY_CREDENTIAL_KEYS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine(
        (v) =>
          v
            .split(',')
            .every((e) => /^[A-Za-z0-9_-]+:[A-Za-z0-9+/]{43}=$/.test(e.trim())),
        { message: 'must be id:base64key pairs, each key 32 bytes' },
      )
      .optional(),
  ),
  // --- Webhooks (outbound delivery) -----------------------------------------
  /**
   * SSRF protection of Webhook deliveries: HTTPS only, and only public
   * addresses (checked after DNS, then connected to exactly). Unset =>
   * on in production, off in development and tests (a receiver on localhost).
   */
  WEBHOOK_SSRF_PROTECTION: z.stringbool().optional(),
  /** Give up on one Webhook attempt after this many milliseconds. */
  WEBHOOK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000),
  /** Stripe Gateway Plugin: all three keys or none. */
  STRIPE_SECRET_KEY: optionalKey(['sk_', 'rk_'], '"sk_" or "rk_"'),
  STRIPE_WEBHOOK_SECRET: optionalKey(['whsec_'], '"whsec_"'),
  STRIPE_PUBLISHABLE_KEY: optionalKey(['pk_'], '"pk_"'),
});

export const envSchema = envObject
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.AUTH_JWT_PRIVATE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_JWT_PRIVATE_KEY'],
        message: 'is required in production (an ES256 PKCS#8 PEM key)',
      });
    }
    if (env.NODE_ENV === 'production' && !env.GATEWAY_CREDENTIAL_KEYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['GATEWAY_CREDENTIAL_KEYS'],
        message:
          'is required in production (id:base64key pairs; each key 32 random bytes)',
      });
    }
    const missing = STRIPE_KEYS.filter((k) => !env[k]);
    if (missing.length > 0 && missing.length < STRIPE_KEYS.length) {
      ctx.addIssue({
        code: 'custom',
        path: [missing[0]],
        message: `Stripe is partly configured: set all of ${STRIPE_KEYS.join(', ')} or none; missing ${missing.join(', ')}`,
      });
      return;
    }
    if (env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY) {
      const secretMode = stripeMode(env.STRIPE_SECRET_KEY);
      const publishableMode = stripeMode(env.STRIPE_PUBLISHABLE_KEY);
      if (secretMode && publishableMode && secretMode !== publishableMode) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_PUBLISHABLE_KEY'],
          message: `STRIPE_SECRET_KEY is a ${secretMode} key but STRIPE_PUBLISHABLE_KEY is a ${publishableMode} key`,
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    PUBLIC_BASE_URL: (
      env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`
    ).replace(/\/+$/, ''),
  }));

export type Env = z.infer<typeof envSchema>;

/** Resolved values derived from the raw environment. */
export function isProduction(env: Pick<Env, 'NODE_ENV'>): boolean {
  return env.NODE_ENV === 'production';
}

export function resolveLogLevel(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
): (typeof LOG_LEVELS)[number] {
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  if (env.NODE_ENV === 'test') return 'silent';
  return isProduction(env) ? 'info' : 'debug';
}

export function resolveSwaggerEnabled(
  env: Pick<Env, 'NODE_ENV' | 'SWAGGER_ENABLED'>,
): boolean {
  return env.SWAGGER_ENABLED ?? !isProduction(env);
}

export function resolveOutboxRelayEnabled(
  env: Pick<Env, 'NODE_ENV' | 'OUTBOX_RELAY_ENABLED'>,
): boolean {
  return env.OUTBOX_RELAY_ENABLED ?? env.NODE_ENV !== 'test';
}

/** Fixed key for development and tests; never accepted in production. */
export const DEVELOPMENT_CREDENTIAL_KEYS =
  'dev:cGF5YnJpZGdlLWRldi1rZXktbm90LWZvci1wcm9kISE=';

export function resolveCredentialKeys(
  env: Pick<Env, 'GATEWAY_CREDENTIAL_KEYS'>,
): string {
  return env.GATEWAY_CREDENTIAL_KEYS ?? DEVELOPMENT_CREDENTIAL_KEYS;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
}

/** The Stripe config when all three keys are set; undefined when none are. */
export function resolveStripeConfig(
  env: Pick<Env, (typeof STRIPE_KEYS)[number]>,
): StripeConfig | undefined {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY } =
    env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !STRIPE_PUBLISHABLE_KEY)
    return undefined;
  return {
    secretKey: STRIPE_SECRET_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    publishableKey: STRIPE_PUBLISHABLE_KEY,
  };
}
