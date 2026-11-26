import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PricingPlanPayments } from '../../src/checkout/domain/services/pricing-plan-references.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import {
  DEFAULT_ORGANIZATION_ID,
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 05: Pricing Plans in the Console, over HTTP on real PostgreSQL.

const prisma = createTestPrismaClient();
let app: INestApplication;
let moduleRef: TestingModule;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
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
  vi.restoreAllMocks();
  await resetDatabase(prisma);
  await ensureOtherOrganization(prisma);
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

async function createPlan(
  as: SignedInHttp = admin,
  body: object = validPlan(),
): Promise<string> {
  const res = await as.post(PLANS).send(body).expect(201);
  return res.body.id as string;
}

describe('editing a Pricing Plan', () => {
  it('replaces every field', async () => {
    const id = await createPlan();
    const edited = {
      name: 'Pro Max',
      description: 'For large teams',
      features: [{ text: 'Everything in Pro', included: true }],
      amount: '299000',
      allowedGatewayIds: [],
      successUrl: null,
      cancelUrl: 'https://shop.example/back',
      expiryMinutes: 120,
    };
    const res = await admin.post(`${PLANS}/${id}`).send(edited).expect(200);
    expect(res.body).toMatchObject(edited);
    const read = await admin.get(`${PLANS}/${id}`).expect(200);
    expect(read.body).toMatchObject(edited);
  });

  it('edits an archived Pricing Plan too, keeping it archived', async () => {
    const id = await createPlan();
    await admin.post(`${PLANS}/${id}/archive`).expect(200);
    const res = await admin
      .post(`${PLANS}/${id}`)
      .send({ ...validPlan(), name: 'Renamed' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Renamed', status: 'ARCHIVED' });
  });

  it('refuses an invalid edit and keeps the Pricing Plan as it was', async () => {
    const id = await createPlan();
    await admin
      .post(`${PLANS}/${id}`)
      .send({ ...validPlan(), amount: '0' })
      .expect(400);
    const read = await admin.get(`${PLANS}/${id}`).expect(200);
    expect(read.body.amount).toBe('199000');
  });

  it('answers 404 for an unknown Pricing Plan', async () => {
    const res = await admin
      .post(`${PLANS}/00000000-0000-7000-8000-00000000ffff`)
      .send(validPlan())
      .expect(404);
    expect(res.body.code).toBe('PRICING_PLAN_NOT_FOUND');
  });
});

describe('archiving and restoring', () => {
  it('archives and restores, returning the Pricing Tables that show it', async () => {
    const id = await createPlan();
    const archived = await admin.post(`${PLANS}/${id}/archive`).expect(200);
    expect(archived.body).toMatchObject({
      id,
      status: 'ARCHIVED',
      pricingTables: [],
    });
    const list = await admin.get(PLANS).expect(200);
    expect(list.body.items[0].status).toBe('ARCHIVED');

    const restored = await admin.post(`${PLANS}/${id}/restore`).expect(200);
    expect(restored.body).toMatchObject({ status: 'ACTIVE', pricingTables: [] });
  });

  it('archiving twice is harmless', async () => {
    const id = await createPlan();
    await admin.post(`${PLANS}/${id}/archive`).expect(200);
    await admin.post(`${PLANS}/${id}/archive`).expect(200);
  });
});

describe('deleting', () => {
  it('deletes a Pricing Plan no Payment references', async () => {
    const id = await createPlan();
    await admin.delete(`${PLANS}/${id}`).expect(200);
    await admin.get(`${PLANS}/${id}`).expect(404);
    await admin.delete(`${PLANS}/${id}`).expect(404);
  });

  it('refuses to delete a Pricing Plan that Payments reference', async () => {
    const id = await createPlan();
    vi.spyOn(
      moduleRef.get(PricingPlanPayments),
      'anyReference',
    ).mockResolvedValue(true);
    const res = await admin.delete(`${PLANS}/${id}`).expect(409);
    expect(res.body.code).toBe('PRICING_PLAN_IN_USE');
    await admin.get(`${PLANS}/${id}`).expect(200);
  });
});

describe('Permissions per Role', () => {
  it('lets an Operator list and view, and refuses every write', async () => {
    const id = await createPlan();
    const operator = await signedInHttp(app, prisma, { role: 'OPERATOR' });
    await operator.get(PLANS).expect(200);
    await operator.get(`${PLANS}/${id}`).expect(200);

    const writes = [
      () => operator.post(PLANS).send(validPlan()),
      () => operator.post(`${PLANS}/${id}`).send(validPlan()),
      () => operator.post(`${PLANS}/${id}/archive`),
      () => operator.post(`${PLANS}/${id}/restore`),
      () => operator.delete(`${PLANS}/${id}`),
    ];
    for (const write of writes) {
      const res = await write().expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const read = await admin.get(`${PLANS}/${id}`).expect(200);
    expect(read.body).toMatchObject({ status: 'ACTIVE', name: 'Pro' });
  });

  it('records who changed a Pricing Plan', async () => {
    const id = await createPlan();
    const read = await admin.get(`${PLANS}/${id}`).expect(200);
    expect(read.body.updatedBy).toEqual({
      userId: admin.user.id,
      role: 'ORGANIZATION_ADMIN',
      name: 'Test ORGANIZATION_ADMIN',
      label: null,
    });
  });

  it('refuses a deactivated Organization Admin at once (sensitive write)', async () => {
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { active: false },
    });
    await admin.post(PLANS).send(validPlan()).expect(403);
  });

  it('needs a signed-in User', async () => {
    await request(app.getHttpServer()).get(PLANS).expect(401);
  });
});

describe('Organization isolation', () => {
  it("never shows or changes another Organization's Pricing Plans", async () => {
    const otherAdmin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId: OTHER_ORGANIZATION_ID,
    });
    const foreign = await createPlan(otherAdmin);
    await createPlan(admin);

    const list = await admin.get(PLANS).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).not.toBe(foreign);

    await admin.get(`${PLANS}/${foreign}`).expect(404);
    await admin.post(`${PLANS}/${foreign}`).send(validPlan()).expect(404);
    await admin.post(`${PLANS}/${foreign}/archive`).expect(404);
    await admin.post(`${PLANS}/${foreign}/restore`).expect(404);
    await admin.delete(`${PLANS}/${foreign}`).expect(404);

    // A header naming another Organization changes nothing for a non-Super Admin.
    await admin
      .get(`${PLANS}/${foreign}`)
      .set('X-Organization-Id', OTHER_ORGANIZATION_ID)
      .expect(404);

    const untouched = await otherAdmin.get(`${PLANS}/${foreign}`).expect(200);
    expect(untouched.body).toMatchObject({ name: 'Pro', status: 'ACTIVE' });
  });
});

describe('Super Admin', () => {
  let superAdmin: SignedInHttp;
  beforeEach(async () => {
    superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
  });

  it("manages a chosen Organization's Pricing Plans, labelled as the platform", async () => {
    const res = await superAdmin
      .post(PLANS)
      .set('X-Organization-Id', OTHER_ORGANIZATION_ID)
      .send(validPlan())
      .expect(201);
    expect(res.body.updatedBy).toMatchObject({
      role: 'SUPER_ADMIN',
      label: 'Super Admin (PayBridge)',
    });

    const otherAdmin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId: OTHER_ORGANIZATION_ID,
    });
    const seen = await otherAdmin.get(`${PLANS}/${res.body.id}`).expect(200);
    expect(seen.body.updatedBy.label).toBe('Super Admin (PayBridge)');
    const own = await admin.get(PLANS).expect(200);
    expect(own.body.items).toHaveLength(0);
  });

  it('must choose exactly one Organization', async () => {
    const none = await superAdmin.post(PLANS).send(validPlan()).expect(403);
    expect(none.body.code).toBe('ORGANIZATION_REQUIRED');
    const all = await superAdmin
      .get(PLANS)
      .set('X-Organization-Id', 'all')
      .expect(403);
    expect(all.body.code).toBe('ORGANIZATION_REQUIRED');
    await superAdmin
      .get(PLANS)
      .set('X-Organization-Id', DEFAULT_ORGANIZATION_ID)
      .expect(200);
  });
});
