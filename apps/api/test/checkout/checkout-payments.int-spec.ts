import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CheckoutClock } from '../../src/checkout/domain/services/clock.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/services/clock.js';
import { bearer } from '../setup/api-keys.js';
import {
  createPricingPlan,
  createPublishableKey,
  SHOP_ORIGIN,
} from '../setup/checkout.js';
import { DEFAULT_ORGANIZATION_ID } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 07: a browser starts, resumes and pays checkout Payments through the
// public checkout endpoints, over HTTP on real PostgreSQL.

const NOW = new Date('2026-11-27T10:00:00.000Z');
const MINUTE = 60_000;

const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let app: INestApplication;
let moduleRef: TestingModule;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(CheckoutClock)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let key: string;
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
  await prisma.publishableKey.deleteMany();
  ({ key } = await createPublishableKey(prisma));
});

const PAYMENTS = '/api/checkout/payments';
const server = () => app.getHttpServer();

function start(body: Record<string, unknown>, publishableKey = key) {
  return request(server())
    .post(PAYMENTS)
    .set(bearer(publishableKey))
    .set('Origin', SHOP_ORIGIN)
    .send(body);
}

const SESSION = 'session-token-0123456789abcdef';

describe('starting a checkout Payment', () => {
  it('takes the Amount and Payment Expiry from the Pricing Plan, even when the browser sends an Amount', async () => {
    const planId = await createPricingPlan(prisma, DEFAULT_ORGANIZATION_ID, {
      name: 'Pro',
      amount: '199000',
      expiryMinutes: 45,
    });

    const res = await start({
      pricingPlanId: planId,
      sessionToken: SESSION,
      amount: '1',
      currency: 'USD',
    }).expect(201);

    expect(res.body).toMatchObject({
      status: 'PENDING',
      amount: '199000',
      currency: 'VND',
      expiresAt: new Date(NOW.getTime() + 45 * MINUTE).toISOString(),
      pricingPlan: { id: planId, name: 'Pro' },
      resumed: false,
    });
  });
});
