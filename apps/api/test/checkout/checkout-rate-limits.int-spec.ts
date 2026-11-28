import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CheckoutClock } from '../../src/checkout/domain/services/clock.js';
import { START_RATE_LIMIT_OPTIONS } from '../../src/checkout/infrastructure/rate-limit/redis-start-rate-limiter.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/services/clock.js';
import { bearer } from '../setup/api-keys.js';
import {
  createPricingPlan,
  createPublishableKey,
  SHOP_ORIGIN,
} from '../setup/checkout.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 07: starting checkout Payments is rate-limited per Publishable Key
// and per client IP, with limits from configuration (here: 3 per key, 5 per
// IP, per minute). Every request comes from the same test client IP.

const NOW = new Date('2026-11-27T10:00:30.000Z');
const PER_KEY = 3;
const PER_IP = 5;

const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
const keyPrefix = `${process.env.QUEUE_PREFIX}-rate-limits`;
const redis = new Redis(process.env.REDIS_URL!);
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(CheckoutClock)
    .useValue(clock)
    .overrideProvider(START_RATE_LIMIT_OPTIONS)
    .useValue({
      perPublishableKey: PER_KEY,
      perClientIp: PER_IP,
      windowSeconds: 60,
      redisUrl: process.env.REDIS_URL,
      keyPrefix,
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

let planId: string;
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
  await prisma.publishableKey.deleteMany();
  const counters = await redis.keys(`${keyPrefix}:*`);
  if (counters.length > 0) await redis.del(...counters);
  planId = await createPricingPlan(prisma);
});

let session = 0;
function start(key: string) {
  session += 1;
  return request(app.getHttpServer())
    .post('/api/checkout/payments')
    .set(bearer(key))
    .set('Origin', SHOP_ORIGIN)
    .send({ pricingPlanId: planId, sessionToken: `rate-limit-session-${session}` });
}

describe('checkout start rate limits', () => {
  it('refuses starts beyond the per-key limit, then allows them in the next window', async () => {
    const { key } = await createPublishableKey(prisma);
    for (let i = 0; i < PER_KEY; i++) await start(key).expect(201);

    const refused = await start(key).expect(429);

    expect(refused.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { limit: 'PUBLISHABLE_KEY', retryAfterSeconds: 30 },
    });
    expect(refused.headers['retry-after']).toBe('30');
    expect(await prisma.payment.count()).toBe(PER_KEY);

    clock.advance(30_000);
    await start(key).expect(201);
  });

  it('refuses starts beyond the per-IP limit across keys', async () => {
    const a = await createPublishableKey(prisma);
    const b = await createPublishableKey(prisma);
    for (let i = 0; i < PER_KEY; i++) await start(a.key).expect(201);
    for (let i = PER_KEY; i < PER_IP; i++) await start(b.key).expect(201);

    const refused = await start(b.key).expect(429);

    expect(refused.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { limit: 'CLIENT_IP' },
    });
  });
});
