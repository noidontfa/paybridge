import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CheckoutClock } from '../../src/checkout/domain/services/clock.js';
import { START_RATE_LIMIT_OPTIONS } from '../../src/checkout/infrastructure/rate-limit/redis-start-rate-limiter.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/services/clock.js';
import {
  createPricingPlan,
  createPublishableKey,
  SHOP_ORIGIN,
} from '../setup/checkout.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Found by ticket 09's browser tests: a Pricing Plan with the shortest
// Payment Expiry (30 minutes) was refused INVALID_EXPIRY whenever Payment
// Core's clock had moved on, even by a millisecond, since the checkout
// module read its own. Core now measures the Pricing Plan's duration itself.

const CHECKOUT_NOW = new Date('2026-11-27T10:00:00.000Z');
const CORE_NOW = new Date(CHECKOUT_NOW.getTime() + 5);
const MINUTE = 60_000;

const prisma = createTestPrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new FakeClock(CORE_NOW))
    .overrideProvider(CheckoutClock)
    .useValue(new FakeClock(CHECKOUT_NOW))
    .overrideProvider(START_RATE_LIMIT_OPTIONS)
    .useValue({
      perPublishableKey: 1_000_000,
      perClientIp: 1_000_000,
      windowSeconds: 60,
      redisUrl: process.env.REDIS_URL,
      keyPrefix: process.env.QUEUE_PREFIX,
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.publishableKey.deleteMany();
});

it('starts a Payment for a Pricing Plan with the shortest Payment Expiry', async () => {
  const { key } = await createPublishableKey(prisma);
  const planId = await createPricingPlan(prisma, undefined, { expiryMinutes: 30 });

  const res = await request(app.getHttpServer())
    .post('/api/checkout/payments')
    .set('Authorization', `Bearer ${key}`)
    .set('Origin', SHOP_ORIGIN)
    .send({ pricingPlanId: planId, sessionToken: 'session-token-0000000001' });

  expect(res.status).toBe(201);
  expect(res.body.expiresAt).toBe(
    new Date(CORE_NOW.getTime() + 30 * MINUTE).toISOString(),
  );
});
