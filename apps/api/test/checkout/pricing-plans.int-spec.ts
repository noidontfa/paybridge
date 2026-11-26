import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 05: Pricing Plans in the Console, over HTTP on real PostgreSQL.

const prisma = createTestPrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
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
});

const PLANS = '/internal/pricing-plans';

const validPlan = () => ({
  name: 'Pro',
  description: 'For growing teams',
  features: [
    { text: 'Unlimited projects', included: true },
    { text: 'Priority support', included: false },
  ],
  amount: '199000',
  allowedGatewayIds: ['fake'],
  successUrl: 'https://shop.example/thanks',
  cancelUrl: 'https://shop.example/pricing',
  expiryMinutes: 60,
});

let admin: SignedInHttp;
beforeEach(async () => {
  admin = await signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN' });
});

describe('creating a Pricing Plan', () => {
  it('stores every field and lists it', async () => {
    const created = await admin.post(PLANS).send(validPlan()).expect(201);
    expect(created.body).toMatchObject({
      ...validPlan(),
      currency: 'VND',
      status: 'ACTIVE',
    });

    const list = await admin.get(PLANS).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: created.body.id,
      name: 'Pro',
      amount: '199000',
    });
    const one = await admin.get(`${PLANS}/${created.body.id}`).expect(200);
    expect(one.body).toMatchObject({ ...validPlan(), pricingTables: [] });
  });
});

describe('validation', () => {
  it('defaults the optional fields', async () => {
    const res = await admin
      .post(PLANS)
      .send({ name: 'Basic', amount: '150000.00' })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Basic',
      description: '',
      features: [],
      amount: '150000',
      allowedGatewayIds: [],
      successUrl: null,
      cancelUrl: null,
      expiryMinutes: 30,
    });
  });

  it('keeps feature lines as typed, as plain text', async () => {
    const features = [{ text: '<b>Bold</b> & <script>x</script>', included: true }];
    const res = await admin
      .post(PLANS)
      .send({ ...validPlan(), features })
      .expect(201);
    expect(res.body.features).toEqual(features);
  });

  it('accepts the Payment Expiry range, both ends inclusive', async () => {
    for (const expiryMinutes of [30, 1440]) {
      await admin.post(PLANS).send({ ...validPlan(), expiryMinutes }).expect(201);
    }
  });

  it.each([
    ['an empty name', { name: '  ' }, 'name'],
    ['eleven feature lines', {
      features: Array.from({ length: 11 }, (_, i) => ({ text: `F${i}`, included: true })),
    }, 'features'],
    ['an empty feature line', { features: [{ text: ' ', included: true }] }, 'features.0.text'],
    ['a multi-line feature', { features: [{ text: 'a\nb', included: true }] }, 'features.0.text'],
    ['a zero Amount', { amount: '0' }, 'amount'],
    ['a negative Amount', { amount: '-5' }, 'amount'],
    ['a fraction of a dong', { amount: '12.5' }, 'amount'],
    ['a non-number Amount', { amount: 'abc' }, 'amount'],
    ['a bad gateway id', { allowedGatewayIds: ['Not A Gateway'] }, 'allowedGatewayIds'],
    ['a plain-HTTP success URL', { successUrl: 'http://shop.example/ok' }, 'successUrl'],
    ['a relative cancel URL', { cancelUrl: '/pricing' }, 'cancelUrl'],
    ['a javascript: URL', { successUrl: 'javascript:alert(1)' }, 'successUrl'],
    ['a Payment Expiry under 30 minutes', { expiryMinutes: 29 }, 'expiryMinutes'],
    ['a Payment Expiry over 24 hours', { expiryMinutes: 1441 }, 'expiryMinutes'],
    ['a fractional Payment Expiry', { expiryMinutes: 30.5 }, 'expiryMinutes'],
  ])('refuses %s', async (_case, change, field) => {
    const res = await admin
      .post(PLANS)
      .send({ ...validPlan(), ...change })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_PRICING_PLAN',
      details: { field },
    });
    const list = await admin.get(PLANS).expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it('refuses a body of the wrong shape', async () => {
    await admin.post(PLANS).send({ name: 'X', amount: 150000 }).expect(400);
  });
});
