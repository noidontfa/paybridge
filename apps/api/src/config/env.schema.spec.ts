import {
  envSchema,
  resolveLogLevel,
  resolveSwaggerEnabled,
} from './env.schema.js';

const DATABASE_URL = 'postgresql://u:p@localhost:5432/db';

describe('envSchema', () => {
  it('applies defaults', () => {
    const env = envSchema.parse({ DATABASE_URL });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('coerces PORT and booleans', () => {
    const env = envSchema.parse({
      DATABASE_URL,
      PORT: '8080',
      SWAGGER_ENABLED: 'false',
    });
    expect(env.PORT).toBe(8080);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('requires a PostgreSQL DATABASE_URL', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    expect(
      envSchema.safeParse({ DATABASE_URL: 'mysql://localhost/db' }).success,
    ).toBe(false);
  });

  it('rejects unknown NODE_ENV / LOG_LEVEL', () => {
    expect(
      envSchema.safeParse({ DATABASE_URL, NODE_ENV: 'staging' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ DATABASE_URL, LOG_LEVEL: 'loud' }).success,
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
