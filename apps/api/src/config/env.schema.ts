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

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
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
});

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
