import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { pricingPlanDetailSchema } from '../contract/console/pricing-plans.js';
import {
  pricingTableListSchema,
  pricingTableSchema,
  publicPricingTableSchema,
} from '../contract/console/pricing-tables.js';
import { bearer, createApiKey } from '../setup/api-keys.js';
import {
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 08: Pricing Tables in the Console, and the public read the SDK uses,
// over HTTP on real PostgreSQL.

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

const PLANS = '/internal/pricing-plans';
const TABLES = '/internal/pricing-tables';
const SHOP = 'https://shop.example.com';
const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';

let admin: SignedInHttp;
beforeEach(async () => {
  await resetDatabase(prisma);
  await ensureOtherOrganization(prisma);
  await prisma.publishableKey.deleteMany();
  admin = await signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN' });
});

async function createPlan(
  as: SignedInHttp,
  name: string,
  extra: object = {},
): Promise<string> {
  const res = await as
    .post(PLANS)
    .send({
      name,
      description: `${name} plan`,
      features: [
        { text: 'Email support', included: true },
        { text: 'Phone support', included: false },
      ],
      amount: '199000',
      ...extra,
    })
    .expect(201);
  return res.body.id as string;
}

const look = {
  mainColor: '#4f46e5',
  theme: 'dark',
  language: 'en',
  buttonText: 'Buy now',
};

async function createTable(
  as: SignedInHttp,
  planIds: string[],
  extra: object = {},
): Promise<string> {
  const res = await as
    .post(TABLES)
    .send({ name: 'Home page', planIds, ...look, ...extra })
    .expect(201);
  return res.body.id as string;
}

describe('creating a Pricing Table', () => {
  it('stores its Pricing Plans in order, the recommended one and the look', async () => {
    const basic = await createPlan(admin, 'Basic');
    const pro = await createPlan(admin, 'Pro');
    const team = await createPlan(admin, 'Team');

    const created = await admin
      .post(TABLES)
      .send({
        name: 'Home page',
        planIds: [team, basic, pro],
        recommendedPlanId: pro,
        ...look,
        mainColor: '#4F46E5',
      })
      .expect(201);
    const expected = {
      name: 'Home page',
      planIds: [team, basic, pro],
      recommendedPlanId: pro,
      ...look,
    };
    expect(created.body).toMatchObject(expected);

    const one = await admin.get(`${TABLES}/${created.body.id}`).expect(200);
    expect(one.body).toMatchObject(expected);
    const list = await admin.get(TABLES).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject(expected);

    // The Console's copied schemas accept every answer (ADR 0004).
    pricingTableSchema.parse(created.body);
    pricingTableSchema.parse(one.body);
    pricingTableListSchema.parse(list.body);
  });

  it('needs no recommended Pricing Plan', async () => {
    const basic = await createPlan(admin, 'Basic');
    const id = await createTable(admin, [basic]);
    const one = await admin.get(`${TABLES}/${id}`).expect(200);
    expect(one.body.recommendedPlanId).toBeNull();
  });

  it.each([
    ['no Pricing Plan', () => ({ planIds: [] }), 'planIds'],
    ['four Pricing Plans', (p: string[]) => ({ planIds: p }), 'planIds'],
    [
      'a recommended Pricing Plan not in the table',
      (p: string[]) => ({ planIds: [p[0]], recommendedPlanId: p[1] }),
      'recommendedPlanId',
    ],
    ['a named colour', (p: string[]) => ({ planIds: [p[0]], mainColor: 'red' }), 'mainColor'],
    ['empty button text', (p: string[]) => ({ planIds: [p[0]], buttonText: ' ' }), 'buttonText'],
  ])('refuses %s', async (_case, change, field) => {
    const plans = [
      await createPlan(admin, 'A'),
      await createPlan(admin, 'B'),
      await createPlan(admin, 'C'),
      await createPlan(admin, 'D'),
    ];
    const res = await admin
      .post(TABLES)
      .send({ name: 'Home page', ...look, ...change(plans) })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_PRICING_TABLE',
      details: { field },
    });
    const list = await admin.get(TABLES).expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it('refuses a theme or language it does not know', async () => {
    const basic = await createPlan(admin, 'Basic');
    await admin
      .post(TABLES)
      .send({ name: 'X', planIds: [basic], ...look, theme: 'blue' })
      .expect(400);
    await admin
      .post(TABLES)
      .send({ name: 'X', planIds: [basic], ...look, language: 'fr' })
      .expect(400);
  });

  it('answers 404 for a Pricing Plan that does not exist', async () => {
    const res = await admin
      .post(TABLES)
      .send({ name: 'X', planIds: [UNKNOWN_ID], ...look })
      .expect(404);
    expect(res.body.code).toBe('PRICING_PLAN_NOT_FOUND');
  });
});

describe('editing and deleting', () => {
  it('replaces every field', async () => {
    const basic = await createPlan(admin, 'Basic');
    const pro = await createPlan(admin, 'Pro');
    const id = await createTable(admin, [basic, pro], { recommendedPlanId: pro });

    const edited = {
      name: 'Promotion',
      planIds: [pro],
      recommendedPlanId: null,
      mainColor: '#16a34a',
      theme: 'light',
      language: 'vi',
      buttonText: 'Mua ngay',
    };
    const res = await admin.post(`${TABLES}/${id}`).send(edited).expect(200);
    expect(res.body).toMatchObject(edited);
    const read = await admin.get(`${TABLES}/${id}`).expect(200);
    expect(read.body).toMatchObject(edited);
  });

  it('keeps the Pricing Table as it was after an invalid edit', async () => {
    const basic = await createPlan(admin, 'Basic');
    const id = await createTable(admin, [basic]);
    await admin
      .post(`${TABLES}/${id}`)
      .send({ name: 'X', planIds: [basic, UNKNOWN_ID], ...look })
      .expect(404);
    const read = await admin.get(`${TABLES}/${id}`).expect(200);
    expect(read.body).toMatchObject({ name: 'Home page', planIds: [basic] });
  });

  it('deletes a Pricing Table outright', async () => {
    const basic = await createPlan(admin, 'Basic');
    const id = await createTable(admin, [basic]);
    await admin.delete(`${TABLES}/${id}`).expect(200);
    await admin.get(`${TABLES}/${id}`).expect(404);
    await admin.delete(`${TABLES}/${id}`).expect(404);
    // Its Pricing Plan is untouched.
    await admin.get(`${PLANS}/${basic}`).expect(200);
  });

  it('answers 404 for an unknown Pricing Table', async () => {
    const basic = await createPlan(admin, 'Basic');
    const res = await admin
      .post(`${TABLES}/${UNKNOWN_ID}`)
      .send({ name: 'X', planIds: [basic], ...look })
      .expect(404);
    expect(res.body.code).toBe('PRICING_TABLE_NOT_FOUND');
  });
});

describe('a Pricing Plan in several Pricing Tables', () => {
  it('is listed by the Pricing Plan, and archiving it returns them', async () => {
    const pro = await createPlan(admin, 'Pro');
    const home = await createTable(admin, [pro], { name: 'Home page' });
    const promo = await createTable(admin, [pro], { name: 'Promotion' });
    const other = await createPlan(admin, 'Other');
    await createTable(admin, [other], { name: 'Unrelated' });

    const tables = [
      { id: home, name: 'Home page' },
      { id: promo, name: 'Promotion' },
    ];
    const read = await admin.get(`${PLANS}/${pro}`).expect(200);
    expect(read.body.pricingTables).toEqual(expect.arrayContaining(tables));
    expect(read.body.pricingTables).toHaveLength(2);

    const archived = await admin.post(`${PLANS}/${pro}/archive`).expect(200);
    expect(archived.body.pricingTables).toEqual(expect.arrayContaining(tables));
    expect(archived.body.pricingTables).toHaveLength(2);
    pricingPlanDetailSchema.parse(archived.body);

    // An archived Pricing Plan stays in its Pricing Tables.
    const table = await admin.get(`${TABLES}/${home}`).expect(200);
    expect(table.body.planIds).toEqual([pro]);
  });

  it('cannot be deleted while a Pricing Table shows it', async () => {
    const pro = await createPlan(admin, 'Pro');
    const table = await createTable(admin, [pro]);
    const res = await admin.delete(`${PLANS}/${pro}`).expect(409);
    expect(res.body.code).toBe('PRICING_PLAN_IN_PRICING_TABLES');

    await admin.delete(`${TABLES}/${table}`).expect(200);
    await admin.delete(`${PLANS}/${pro}`).expect(200);
  });
});

describe('Permissions per Role', () => {
  it('lets an Operator list and view, and refuses every write', async () => {
    const basic = await createPlan(admin, 'Basic');
    const id = await createTable(admin, [basic]);
    const operator = await signedInHttp(app, prisma, { role: 'OPERATOR' });
    await operator.get(TABLES).expect(200);
    await operator.get(`${TABLES}/${id}`).expect(200);

    const body = { name: 'X', planIds: [basic], ...look };
    for (const write of [
      () => operator.post(TABLES).send(body),
      () => operator.post(`${TABLES}/${id}`).send(body),
      () => operator.delete(`${TABLES}/${id}`),
    ]) {
      const res = await write().expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const read = await admin.get(`${TABLES}/${id}`).expect(200);
    expect(read.body.name).toBe('Home page');
  });

  it('records who changed a Pricing Table', async () => {
    const basic = await createPlan(admin, 'Basic');
    const id = await createTable(admin, [basic]);
    const read = await admin.get(`${TABLES}/${id}`).expect(200);
    expect(read.body.updatedBy).toEqual({
      userId: admin.user.id,
      role: 'ORGANIZATION_ADMIN',
      name: 'Test ORGANIZATION_ADMIN',
      label: null,
    });
  });

  it('labels a Super Admin change as the platform', async () => {
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    const otherAdmin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId: OTHER_ORGANIZATION_ID,
    });
    const plan = await createPlan(otherAdmin, 'Basic');
    const res = await superAdmin
      .post(TABLES)
      .set('X-Organization-Id', OTHER_ORGANIZATION_ID)
      .send({ name: 'X', planIds: [plan], ...look })
      .expect(201);
    expect(res.body.updatedBy).toMatchObject({
      role: 'SUPER_ADMIN',
      label: 'Super Admin (PayBridge)',
    });
    const seen = await otherAdmin.get(`${TABLES}/${res.body.id}`).expect(200);
    expect(seen.body.updatedBy.label).toBe('Super Admin (PayBridge)');
  });

  it('needs a signed-in User', async () => {
    await request(app.getHttpServer()).get(TABLES).expect(401);
  });
});

describe('Organization isolation', () => {
  let otherAdmin: SignedInHttp;
  beforeEach(async () => {
    otherAdmin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId: OTHER_ORGANIZATION_ID,
    });
  });

  it("treats another Organization's Pricing Plan as not found", async () => {
    const foreignPlan = await createPlan(otherAdmin, 'Theirs');
    const mine = await createPlan(admin, 'Mine');
    const res = await admin
      .post(TABLES)
      .send({ name: 'X', planIds: [mine, foreignPlan], ...look })
      .expect(404);
    expect(res.body.code).toBe('PRICING_PLAN_NOT_FOUND');

    const id = await createTable(admin, [mine]);
    await admin
      .post(`${TABLES}/${id}`)
      .send({ name: 'X', planIds: [foreignPlan], ...look })
      .expect(404);
  });

  it("never shows or changes another Organization's Pricing Tables", async () => {
    const foreign = await createTable(otherAdmin, [
      await createPlan(otherAdmin, 'Theirs'),
    ]);
    const mine = await createPlan(admin, 'Mine');
    await createTable(admin, [mine]);

    const list = await admin.get(TABLES).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).not.toBe(foreign);
    await admin.get(`${TABLES}/${foreign}`).expect(404);
    await admin
      .post(`${TABLES}/${foreign}`)
      .send({ name: 'X', planIds: [mine], ...look })
      .expect(404);
    await admin.delete(`${TABLES}/${foreign}`).expect(404);

    const untouched = await otherAdmin.get(`${TABLES}/${foreign}`).expect(200);
    expect(untouched.body.name).toBe('Home page');
  });
});

// ---------------------------------------------------------------------------
// The public read: what the SDK draws on the host page.
// ---------------------------------------------------------------------------

async function createKey(
  as: SignedInHttp,
  allowedOrigins: string[] = [SHOP],
): Promise<string> {
  const res = await as
    .post('/internal/publishable-keys')
    .send({ label: 'Website', allowedOrigins })
    .expect(201);
  return res.body.key as string;
}

const read = (key: string | undefined, id: string, origin: string = SHOP) => {
  let req = request(app.getHttpServer())
    .get(`/api/checkout/pricing-tables/${id}`)
    .set('Origin', origin);
  if (key) req = req.set(bearer(key));
  return req;
};

function expectUnavailable(
  res: { status: number; body: Record<string, unknown> },
  reason: string,
) {
  expect(res.status).toBe(422);
  expect(res.body).toMatchObject({
    code: 'CHECKOUT_UNAVAILABLE',
    message: 'Payment is not available right now',
    details: { reason },
  });
}

describe('reading a Pricing Table for display', () => {
  it('returns the look and, per Pricing Plan, what the cards show', async () => {
    const basic = await createPlan(admin, 'Basic', { amount: '99000' });
    const pro = await createPlan(admin, 'Pro', { allowedGatewayIds: ['fake'] });
    const id = await createTable(admin, [pro, basic], { recommendedPlanId: pro });
    const key = await createKey(admin);

    const res = await read(key, id).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(SHOP);
    expect(res.body).toEqual({
      id,
      mainColor: '#4f46e5',
      theme: 'dark',
      language: 'en',
      buttonText: 'Buy now',
      plans: [
        {
          id: pro,
          name: 'Pro',
          description: 'Pro plan',
          features: [
            { text: 'Email support', included: true },
            { text: 'Phone support', included: false },
          ],
          amount: '199000',
          currency: 'VND',
          recommended: true,
          gateways: [{ id: 'fake' }],
          buyable: true,
          unavailableReason: null,
        },
        expect.objectContaining({
          id: basic,
          name: 'Basic',
          amount: '99000',
          recommended: false,
          buyable: true,
        }),
      ],
    });
    publicPricingTableSchema.parse(res.body);
  });

  it('shows only the PaymentGateways that are both allowed and enabled', async () => {
    const all = await createPlan(admin, 'All');
    const onlyFake = await createPlan(admin, 'Fake', { allowedGatewayIds: ['fake'] });
    const unknown = await createPlan(admin, 'Gone', {
      allowedGatewayIds: ['not-connected'],
    });
    const id = await createTable(admin, [all, onlyFake, unknown]);
    const key = await createKey(admin);

    const before = await read(key, id).expect(200);
    const gatewaysOf = (body: { plans: { gateways: { id: string }[] }[] }) =>
      body.plans.map((p) => p.gateways.map((g) => g.id));
    // Every enabled one for an empty allow-list; none for an unconnected one.
    expect(gatewaysOf(before.body)[0]).toContain('fake');
    expect(gatewaysOf(before.body)[1]).toEqual(['fake']);
    expect(before.body.plans[2]).toMatchObject({
      gateways: [],
      buyable: false,
      unavailableReason: 'NO_GATEWAY_AVAILABLE',
    });

    // A disabled Gateway Connection disappears from the choices.
    await prisma.gatewayConnection.updateMany({
      where: { gatewayId: 'fake' },
      data: { enabled: false },
    });
    const after = await read(key, id).expect(200);
    expect(gatewaysOf(after.body)[0]).not.toContain('fake');
    expect(after.body.plans[1]).toMatchObject({
      gateways: [],
      buyable: false,
      unavailableReason: 'NO_GATEWAY_AVAILABLE',
    });
  });

  it('keeps an archived Pricing Plan in its column, not buyable', async () => {
    const basic = await createPlan(admin, 'Basic');
    const pro = await createPlan(admin, 'Pro');
    const id = await createTable(admin, [basic, pro]);
    await admin.post(`${PLANS}/${pro}/archive`).expect(200);
    const key = await createKey(admin);

    const res = await read(key, id).expect(200);
    expect(res.body.plans.map((p: { id: string }) => p.id)).toEqual([basic, pro]);
    expect(res.body.plans[0]).toMatchObject({ buyable: true, unavailableReason: null });
    expect(res.body.plans[1]).toMatchObject({
      name: 'Pro',
      buyable: false,
      unavailableReason: 'PRICING_PLAN_ARCHIVED',
    });
  });

  it('follows edits to the Pricing Table and its Pricing Plans', async () => {
    const basic = await createPlan(admin, 'Basic');
    const id = await createTable(admin, [basic]);
    const key = await createKey(admin);
    await admin
      .post(`${PLANS}/${basic}`)
      .send({ name: 'Starter', amount: '120000' })
      .expect(200);
    await admin
      .post(`${TABLES}/${id}`)
      .send({ name: 'X', planIds: [basic], ...look, buttonText: 'Get it' })
      .expect(200);

    const res = await read(key, id).expect(200);
    expect(res.body).toMatchObject({
      buttonText: 'Get it',
      plans: [{ name: 'Starter', amount: '120000' }],
    });
  });

  describe('is unavailable, with a reason for developers,', () => {
    it('for a deleted or unknown Pricing Table', async () => {
      const id = await createTable(admin, [await createPlan(admin, 'Basic')]);
      const key = await createKey(admin);
      await admin.delete(`${TABLES}/${id}`).expect(200);
      expectUnavailable(await read(key, id), 'PRICING_TABLE_NOT_FOUND');
      expectUnavailable(await read(key, 'not-a-uuid'), 'PRICING_TABLE_NOT_FOUND');
    });

    it("for another Organization's Pricing Table", async () => {
      const otherAdmin = await signedInHttp(app, prisma, {
        role: 'ORGANIZATION_ADMIN',
        organizationId: OTHER_ORGANIZATION_ID,
      });
      const foreign = await createTable(otherAdmin, [
        await createPlan(otherAdmin, 'Theirs'),
      ]);
      const myKey = await createKey(admin);
      expectUnavailable(await read(myKey, foreign), 'PRICING_TABLE_NOT_FOUND');
    });

    it('for a suspended Organization', async () => {
      const otherAdmin = await signedInHttp(app, prisma, {
        role: 'ORGANIZATION_ADMIN',
        organizationId: OTHER_ORGANIZATION_ID,
      });
      const id = await createTable(otherAdmin, [
        await createPlan(otherAdmin, 'Theirs'),
      ]);
      const key = await createKey(otherAdmin);
      await read(key, id).expect(200);
      await prisma.organization.update({
        where: { id: OTHER_ORGANIZATION_ID },
        data: { status: 'SUSPENDED' },
      });
      try {
        expectUnavailable(await read(key, id), 'ORGANIZATION_SUSPENDED');
      } finally {
        await prisma.organization.update({
          where: { id: OTHER_ORGANIZATION_ID },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('for a revoked or missing Publishable Key', async () => {
      const id = await createTable(admin, [await createPlan(admin, 'Basic')]);
      const res = await admin
        .post('/internal/publishable-keys')
        .send({ label: 'Website', allowedOrigins: [SHOP] })
        .expect(201);
      await admin
        .post(`/internal/publishable-keys/${res.body.id}/revoke`)
        .expect(200);
      expectUnavailable(await read(res.body.key, id), 'INVALID_PUBLISHABLE_KEY');
      expectUnavailable(await read(undefined, id), 'INVALID_PUBLISHABLE_KEY');
    });

    it('for a website the key does not allow', async () => {
      const id = await createTable(admin, [await createPlan(admin, 'Basic')]);
      const key = await createKey(admin);
      const res = await read(key, id, 'https://evil.example');
      expectUnavailable(res, 'ORIGIN_NOT_ALLOWED');
      // The SDK can still read the reason from the browser.
      expect(res.headers['access-control-allow-origin']).toBe(
        'https://evil.example',
      );
    });
  });

  it('refuses an API Key', async () => {
    const id = await createTable(admin, [await createPlan(admin, 'Basic')]);
    const apiKey = await createApiKey(prisma);
    expectUnavailable(await read(apiKey, id), 'INVALID_PUBLISHABLE_KEY');
  });
});
