import {
  envSchema,
  resolveLogLevel,
  resolveOutboxRelayEnabled,
  resolveStripeConfig,
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

  it('defaults PUBLIC_BASE_URL to localhost and validates it as an http(s) URL', () => {
    expect(envSchema.parse(required).PUBLIC_BASE_URL).toBe(
      'http://localhost:3000',
    );
    expect(envSchema.parse({ ...required, PORT: '8080' }).PUBLIC_BASE_URL).toBe(
      'http://localhost:8080',
    );
    expect(
      envSchema.parse({
        ...required,
        PUBLIC_BASE_URL: 'https://pay.example.com/',
      }).PUBLIC_BASE_URL,
    ).toBe('https://pay.example.com');
    for (const bad of ['pay.example.com', 'ftp://x.test', 'not a url']) {
      expect(
        envSchema.safeParse({ ...required, PUBLIC_BASE_URL: bad }).success,
      ).toBe(false);
    }
  });

  it('requires the access-token signing key in production only', () => {
    expect(envSchema.safeParse(required).success).toBe(true);
    expect(
      envSchema.safeParse({ ...required, NODE_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...required,
        NODE_ENV: 'production',
        AUTH_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\n...',
      }).success,
    ).toBe(true);
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

  it('defaults the expiry sweep batch size to 100 and requires a positive integer', () => {
    expect(envSchema.parse(required).EXPIRY_SWEEP_BATCH_SIZE).toBe(100);
    expect(
      envSchema.parse({ ...required, EXPIRY_SWEEP_BATCH_SIZE: '250' })
        .EXPIRY_SWEEP_BATCH_SIZE,
    ).toBe(250);
    for (const bad of ['0', '-1', '1.5', 'many']) {
      expect(
        envSchema.safeParse({ ...required, EXPIRY_SWEEP_BATCH_SIZE: bad })
          .success,
      ).toBe(false);
    }
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

describe('Stripe configuration', () => {
  const sk = 'sk_test_abc';
  const whsec = 'whsec_abc';
  const pk = 'pk_test_abc';
  const all = {
    STRIPE_SECRET_KEY: sk,
    STRIPE_WEBHOOK_SECRET: whsec,
    STRIPE_PUBLISHABLE_KEY: pk,
  };

  function issueText(input: Record<string, string>): string {
    const result = envSchema.safeParse({ ...required, ...input });
    expect(result.success).toBe(false);
    return result.error ? JSON.stringify(result.error.issues) : '';
  }

  it('resolves the config when all three keys are set', () => {
    const env = envSchema.parse({ ...required, ...all });
    expect(resolveStripeConfig(env)).toEqual({
      secretKey: sk,
      webhookSecret: whsec,
      publishableKey: pk,
    });
  });

  it('accepts a restricted secret key (rk_)', () => {
    const env = envSchema.parse({
      ...required,
      ...all,
      STRIPE_SECRET_KEY: 'rk_test_abc',
    });
    expect(resolveStripeConfig(env)?.secretKey).toBe('rk_test_abc');
  });

  it('resolves nothing when none are set, or all are empty', () => {
    expect(resolveStripeConfig(envSchema.parse(required))).toBeUndefined();
    expect(
      resolveStripeConfig(
        envSchema.parse({
          ...required,
          STRIPE_SECRET_KEY: '',
          STRIPE_WEBHOOK_SECRET: '',
          STRIPE_PUBLISHABLE_KEY: '',
        }),
      ),
    ).toBeUndefined();
  });

  it('fails when only one key is set, naming the missing keys', () => {
    const text = issueText({ STRIPE_SECRET_KEY: sk });
    expect(text).toContain('STRIPE_WEBHOOK_SECRET');
    expect(text).toContain('STRIPE_PUBLISHABLE_KEY');
    expect(text).not.toMatch(/missing[^"]*STRIPE_SECRET_KEY/);
  });

  it('fails when two keys are set, naming the one missing', () => {
    const text = issueText({
      STRIPE_SECRET_KEY: sk,
      STRIPE_PUBLISHABLE_KEY: pk,
    });
    expect(text).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('rejects keys with the wrong prefix', () => {
    for (const bad of [
      { ...all, STRIPE_SECRET_KEY: 'pk_test_abc' },
      { ...all, STRIPE_WEBHOOK_SECRET: 'sk_test_abc' },
      { ...all, STRIPE_PUBLISHABLE_KEY: 'sk_test_abc' },
    ]) {
      expect(envSchema.safeParse({ ...required, ...bad }).success).toBe(false);
    }
  });

  it('rejects mixing test and live mode', () => {
    expect(
      envSchema.safeParse({
        ...required,
        ...all,
        STRIPE_SECRET_KEY: 'sk_test_abc',
        STRIPE_PUBLISHABLE_KEY: 'pk_live_abc',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...required,
        ...all,
        STRIPE_SECRET_KEY: 'rk_live_abc',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
      }).success,
    ).toBe(false);
  });

  it('accepts matching live keys', () => {
    expect(
      envSchema.safeParse({
        ...required,
        ...all,
        STRIPE_SECRET_KEY: 'sk_live_abc',
        STRIPE_PUBLISHABLE_KEY: 'pk_live_abc',
      }).success,
    ).toBe(true);
  });
});
