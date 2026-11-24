import {
  envSchema,
  resolveLogLevel,
  resolveOutboxRelayEnabled,
  resolveSwaggerEnabled,
} from './env.schema.js';

const DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
const REDIS_URL = 'redis://localhost:6379';
const required = { DATABASE_URL, REDIS_URL };

describe('envSchema', () => {
  it('applies defaults', () => {
    const env = envSchema.parse(required);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('coerces PORT and booleans', () => {
    const env = envSchema.parse({
      ...required,
      PORT: '8080',
      SWAGGER_ENABLED: 'false',
    });
    expect(env.PORT).toBe(8080);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('requires a PostgreSQL DATABASE_URL', () => {
    expect(envSchema.safeParse({ REDIS_URL }).success).toBe(false);
    expect(
      envSchema.safeParse({ REDIS_URL, DATABASE_URL: 'mysql://localhost/db' })
        .success,
    ).toBe(false);
  });

  it('requires a Redis REDIS_URL', () => {
    expect(envSchema.safeParse({ DATABASE_URL }).success).toBe(false);
    expect(
      envSchema.safeParse({ DATABASE_URL, REDIS_URL: 'http://localhost:6379' })
        .success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ DATABASE_URL, REDIS_URL: 'rediss://cache:6380/1' })
        .success,
    ).toBe(true);
  });

  it('defaults the queue prefix and rejects one containing a colon', () => {
    expect(envSchema.parse(required).QUEUE_PREFIX).toBe('paybridge');
    expect(
      envSchema.safeParse({ ...required, QUEUE_PREFIX: 'a:b' }).success,
    ).toBe(false);
  });

  it('rejects unknown NODE_ENV / LOG_LEVEL', () => {
    expect(
      envSchema.safeParse({ ...required, NODE_ENV: 'staging' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...required, LOG_LEVEL: 'loud' }).success,
    ).toBe(false);
  });
});

describe('environment-derived defaults', () => {
  it('log level: debug in dev, info in prod, silent in test, explicit wins', () => {
    expect(resolveLogLevel({ NODE_ENV: 'development' })).toBe('debug');
    expect(resolveLogLevel({ NODE_ENV: 'production' })).toBe('info');
    expect(resolveLogLevel({ NODE_ENV: 'test' })).toBe('silent');
    expect(resolveLogLevel({ NODE_ENV: 'production', LOG_LEVEL: 'warn' })).toBe(
      'warn',
    );
  });

  it('swagger: on outside production unless explicitly set', () => {
    expect(resolveSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(resolveSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      resolveSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: true }),
    ).toBe(true);
  });
});

describe('outbox relay settings', () => {
  it('defaults to polling every second, 100 rows at a time', () => {
    const env = envSchema.parse(required);
    expect(env.OUTBOX_RELAY_POLL_INTERVAL_MS).toBe(1000);
    expect(env.OUTBOX_RELAY_BATCH_SIZE).toBe(100);
  });

  it('runs the relay everywhere except test unless set explicitly', () => {
    expect(resolveOutboxRelayEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(resolveOutboxRelayEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(resolveOutboxRelayEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(
      resolveOutboxRelayEnabled({
        NODE_ENV: 'production',
        OUTBOX_RELAY_ENABLED: false,
      }),
    ).toBe(false);
  });

  it('rejects a batch size of zero', () => {
    expect(
      envSchema.safeParse({ ...required, OUTBOX_RELAY_BATCH_SIZE: '0' })
        .success,
    ).toBe(false);
  });
});
