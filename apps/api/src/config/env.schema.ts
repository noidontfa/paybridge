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
