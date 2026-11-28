import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { createOrganization } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 01: Webhook Endpoint management over HTTP. An Organization Admin
// registers the URLs of its systems; Operators cannot change them.

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

const PATH = '/internal/webhook-endpoints';
const admin = (organizationId?: string): Promise<SignedInHttp> =>
  signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN', organizationId });

interface EndpointView {
  id: string;
  url: string;
  eventKinds: string[];
  status: 'ENABLED' | 'DISABLED';
  secretPrefix: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: { name: string; role: string; label: string | null };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://erp.example.com/paybridge',
  eventKinds: ['payment.succeeded'],
  ...overrides,
});

async function createEndpoint(
  http: SignedInHttp,
  overrides: Record<string, unknown> = {},
): Promise<EndpointView & { secret: string }> {
  const res = await http.post(PATH).send(body(overrides)).expect(201);
  return res.body as EndpointView & { secret: string };
}

async function list(http: SignedInHttp): Promise<EndpointView[]> {
  const res = await http.get(PATH).expect(200);
  return (res.body as { items: EndpointView[] }).items;
}

describe('creating a Webhook Endpoint', () => {
  it('returns the signing secret in full once, then only its prefix', async () => {
    const http = await admin();

    const created = await createEndpoint(http, {
      eventKinds: ['payment.created', 'payment.succeeded'],
    });

    expect(created).toMatchObject({
      url: 'https://erp.example.com/paybridge',
      eventKinds: ['payment.created', 'payment.succeeded'],
      status: 'ENABLED',
    });
    expect(created.secret).toMatch(/^whsec_pb_[A-Za-z0-9_-]{40,}$/);
    expect(created.secret.startsWith(created.secretPrefix)).toBe(true);
    expect(created.secretPrefix.length).toBeLessThan(created.secret.length);
    const listed = await http.get(PATH).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.secret);
    expect(listed.body.items[0].secretPrefix).toBe(created.secretPrefix);
  });

  it('stores the secret encrypted, never in clear', async () => {
    const http = await admin();
    const created = await createEndpoint(http);

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM wh_endpoints WHERE id = ${created.id}::uuid`;

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(created.secret);
    expect(JSON.stringify(rows[0])).not.toContain(
      created.secret.slice('whsec_pb_'.length),
    );
  });

  it('accepts every Payment Event kind', async () => {
    const http = await admin();
    const kinds = [
      'payment.created',
      'payment.succeeded',
      'payment.cancelled',
      'payment.expired',
      'payment.requires_review',
    ];
    const created = await createEndpoint(http, { eventKinds: kinds });
    expect(created.eventKinds).toEqual(kinds);
  });

  it.each([
    ['an unknown kind', { eventKinds: ['payment.refunded'] }],
    ['no kind', { eventKinds: [] }],
    ['a URL that is not one', { url: 'not a url' }],
    ['a URL with credentials', { url: 'https://u:p@example.com/x' }],
  ])('rejects %s', async (_, overrides) => {
    const http = await admin();
    const res = await http.post(PATH).send(body(overrides));
    expect(res.status).toBe(400);
  });

  it('records who wrote it', async () => {
    const http = await admin();
    const created = await createEndpoint(http);
    expect(created.updatedBy).toEqual({
      name: 'Test ORGANIZATION_ADMIN',
      role: 'ORGANIZATION_ADMIN',
      label: null,
    });
  });
});

describe('managing Webhook Endpoints', () => {
  it('lists several endpoints of the Organization only', async () => {
    const http = await admin();
    const other = await admin(await createOrganization(prisma));
    const a = await createEndpoint(http, { url: 'https://a.example.com/x' });
    const b = await createEndpoint(http, { url: 'https://b.example.com/x' });
    await createEndpoint(other, { url: 'https://other.example.com/x' });

    const items = await list(http);

    expect(items.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('edits the URL and the kinds', async () => {
    const http = await admin();
    const created = await createEndpoint(http);

    const res = await http
      .post(`${PATH}/${created.id}`)
      .send({
        url: 'https://new.example.com/hook',
        eventKinds: ['payment.expired'],
      })
      .expect(200);

    expect(res.body).toMatchObject({
      id: created.id,
      url: 'https://new.example.com/hook',
      eventKinds: ['payment.expired'],
      secretPrefix: created.secretPrefix,
    });
    expect(res.body.secret).toBeUndefined();
  });

  it('disables and enables an endpoint', async () => {
    const http = await admin();
    const created = await createEndpoint(http);

    await http.post(`${PATH}/${created.id}/disable`).expect(200);
    expect((await list(http))[0]!.status).toBe('DISABLED');

    await http.post(`${PATH}/${created.id}/enable`).expect(200);
    expect((await list(http))[0]!.status).toBe('ENABLED');
  });

  it('deletes an endpoint', async () => {
    const http = await admin();
    const created = await createEndpoint(http);

    await http.delete(`${PATH}/${created.id}`).expect(204);

    expect(await list(http)).toEqual([]);
    await http.post(`${PATH}/${created.id}/enable`).expect(404);
  });

  it("cannot touch another Organization's endpoint", async () => {
    const http = await admin();
    const other = await admin(await createOrganization(prisma));
    const theirs = await createEndpoint(other);

    await http.post(`${PATH}/${theirs.id}/disable`).expect(404);
    await http
      .post(`${PATH}/${theirs.id}`)
      .send({ url: 'https://evil.example.com/x' })
      .expect(404);
    await http.delete(`${PATH}/${theirs.id}`).expect(404);
    expect((await list(other))[0]).toMatchObject({
      status: 'ENABLED',
      url: theirs.url,
    });
  });
});

describe('who may manage Webhook Endpoints', () => {
  it('refuses an Operator every write', async () => {
    const owner = await admin();
    const existing = await createEndpoint(owner);
    const operator = await signedInHttp(app, prisma, { role: 'OPERATOR' });

    await operator.post(PATH).send(body()).expect(403);
    await operator.post(`${PATH}/${existing.id}`).send(body()).expect(403);
    await operator.post(`${PATH}/${existing.id}/disable`).expect(403);
    await operator.post(`${PATH}/${existing.id}/enable`).expect(403);
    await operator.delete(`${PATH}/${existing.id}`).expect(403);
  });

  it('is a sensitive write: a deactivated Admin is refused at once', async () => {
    const http = await admin();
    await prisma.user.update({
      where: { id: http.user.id },
      data: { active: false },
    });

    const res = await http.post(PATH).send(body());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('labels a Super Admin write as the platform', async () => {
    const organizationId = await createOrganization(prisma);
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send(body())
      .expect(201);

    expect(res.body.updatedBy).toMatchObject({
      role: 'SUPER_ADMIN',
      label: 'Super Admin (PayBridge)',
    });
    const owner = await admin(organizationId);
    expect((await list(owner))[0]!.updatedBy.label).toBe(
      'Super Admin (PayBridge)',
    );
  });
});
