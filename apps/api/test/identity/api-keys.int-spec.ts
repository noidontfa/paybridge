import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { createOrganization } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 09: API Keys, over HTTP on real PostgreSQL. An Organization Admin
// manages keys; the public payments API authenticates by key.

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
  await prisma.apiKey.deleteMany();
});

const server = () => app.getHttpServer();
const admin = (organizationId?: string): Promise<SignedInHttp> =>
  signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN', organizationId });

async function createKey(http: SignedInHttp, label = 'Billing system') {
  const res = await http.post('/internal/api-keys').send({ label }).expect(201);
  return res.body as {
    id: string;
    label: string;
    prefix: string;
    key: string;
    createdAt: string;
  };
}

const payment = () => ({
  amount: '150000',
  currency: 'VND',
  upstreamReference: `order-${newId()}`,
});
const createPayment = (key?: string) => {
  const req = request(server()).post('/api/payments');
  return (key ? req.set('Authorization', `Bearer ${key}`) : req).send(payment());
};

describe('creating an API Key', () => {
  it('returns the full key once, with a recognisable prefix', async () => {
    const http = await admin();

    const created = await createKey(http);

    expect(created.key).toMatch(/^pb_live_[A-Za-z0-9_-]{32,}$/);
    expect(created.key.startsWith(created.prefix)).toBe(true);
    expect(created.prefix.length).toBeLessThan(created.key.length);
    const listed = await http.get('/internal/api-keys').expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.key);
  });

  it('stores only a hash, never the key', async () => {
    const http = await admin();
    const created = await createKey(http);

    const row = await prisma.apiKey.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(row.keyHash).not.toContain(created.key);
    expect(row.prefix).toBe(created.prefix);
    expect(row.lastUsedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
  });

  it('rejects a blank label', async () => {
    const http = await admin();
    await http.post('/internal/api-keys').send({ label: '  ' }).expect(400);
  });

  it('is refused for an Operator', async () => {
    const operator = await signedInHttp(app, prisma, { role: 'OPERATOR' });
    await operator.post('/internal/api-keys').send({ label: 'x' }).expect(403);
    await operator.get('/internal/api-keys').expect(403);
  });

  it('is a sensitive write: a deactivated Admin is refused at once', async () => {
    const http = await admin();
    await prisma.user.update({
      where: { id: http.user.id },
      data: { active: false },
    });

    const res = await http.post('/internal/api-keys').send({ label: 'x' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });
});

describe('listing API Keys', () => {
  it('shows several active keys of the Organization only, newest first', async () => {
    const http = await admin();
    const other = await admin(await createOrganization(prisma));
    const first = await createKey(http, 'first');
    const second = await createKey(http, 'second');
    await createKey(other, 'not mine');

    const res = await http.get('/internal/api-keys').expect(200);

    expect(res.body.items.map((k: { id: string }) => k.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(res.body.items[0]).toEqual({
      id: second.id,
      label: 'second',
      prefix: second.prefix,
      createdAt: expect.any(String),
      lastUsedAt: null,
      revokedAt: null,
    });
  });
});

describe('the public payments API', () => {
  it('creates the Payment in the key’s Organization and records the last use', async () => {
    const orgId = await createOrganization(prisma);
    const { key, id } = await createKey(await admin(orgId));

    const res = await createPayment(key).expect(201);

    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row.organizationId).toBe(orgId);
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it.each([
    ['no key', undefined],
    ['an unknown key', 'pb_live_notarealkeynotarealkeynotarealkey00'],
    ['a malformed header', 'garbage'],
  ])('refuses %s with 401', async (_name, key) => {
    const res = await createPayment(key);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('refuses a revoked key on the next request', async () => {
    const http = await admin();
    const { key, id } = await createKey(http);
    await createPayment(key).expect(201);

    await http.post(`/internal/api-keys/${id}/revoke`).expect(200);

    await createPayment(key).expect(401);
    const listed = await http.get('/internal/api-keys').expect(200);
    expect(listed.body.items[0].revokedAt).not.toBeNull();
  });

  it('lets a second key keep working while the first is revoked', async () => {
    const http = await admin();
    const old = await createKey(http, 'old');
    const next = await createKey(http, 'new');

    await http.post(`/internal/api-keys/${old.id}/revoke`).expect(200);

    await createPayment(old.key).expect(401);
    await createPayment(next.key).expect(201);
  });

  it('refuses the key of a suspended Organization', async () => {
    const orgId = await createOrganization(prisma);
    const { key } = await createKey(await admin(orgId));
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: 'SUSPENDED' },
    });

    const res = await createPayment(key);

    expect(res.status).toBe(401);
  });

  it('gives not-found for another Organization’s Payment', async () => {
    const mine = await createKey(await admin(await createOrganization(prisma)));
    const theirs = await createKey(await admin(await createOrganization(prisma)));
    const created = await createPayment(theirs.key).expect(201);

    await request(server())
      .get(`/api/payments/${created.body.id}`)
      .set('Authorization', `Bearer ${mine.key}`)
      .expect(404);
    await request(server())
      .post(`/api/payments/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${mine.key}`)
      .expect(404);
  });
});

describe('revoking an API Key', () => {
  it('is refused for another Organization’s key (not found)', async () => {
    const http = await admin();
    const other = await createKey(await admin(await createOrganization(prisma)));

    await http.post(`/internal/api-keys/${other.id}/revoke`).expect(404);
  });

  it('is idempotent', async () => {
    const http = await admin();
    const { id } = await createKey(http);

    await http.post(`/internal/api-keys/${id}/revoke`).expect(200);
    await http.post(`/internal/api-keys/${id}/revoke`).expect(200);
  });
});
