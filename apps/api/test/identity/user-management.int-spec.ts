import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { createOrganization } from '../setup/organizations.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import {
  createUser,
  refresh,
  signIn,
  signInOk,
  signedInHttp,
  type SignedInHttp,
} from '../setup/users.js';

// Ticket 08: User management over HTTP on real PostgreSQL.

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

const withOrg = (call: request.Test, organization?: string): request.Test =>
  organization ? call.set('X-Organization-Id', organization) : call;

function patchRole(
  http: SignedInHttp,
  userId: string,
  role: string,
  organization?: string,
): request.Test {
  const call = request(app.getHttpServer())
    .post(`/internal/users/${userId}/role`)
    .set('Authorization', `Bearer ${http.accessToken}`);
  return withOrg(call, organization).send({ role });
}

const roleOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).role;

async function setup() {
  const organizationId = await createOrganization(prisma, 'Managed');
  const admin = await signedInHttp(app, prisma, {
    role: 'ORGANIZATION_ADMIN',
    organizationId,
  });
  const operator = await createUser(prisma, { organizationId });
  return { organizationId, admin, operator };
}

describe('listing Users', () => {
  it('shows the Organization Users with Role and active state, and no one else', async () => {
    const { organizationId, admin, operator } = await setup();
    const gone = await createUser(prisma, { organizationId, active: false });
    const elsewhere = await createUser(prisma, {
      organizationId: await createOrganization(prisma, 'Elsewhere'),
    });

    const res = await admin.get('/internal/users').expect(200);
    const byId = new Map(
      (res.body.items as { id: string }[]).map((u) => [u.id, u]),
    );
    expect(byId.size).toBe(3);
    expect(byId.has(elsewhere.id)).toBe(false);
    expect(byId.get(operator.id)).toMatchObject({
      email: operator.email,
      role: 'OPERATOR',
      active: true,
    });
    expect(byId.get(gone.id)).toMatchObject({ active: false });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('is refused to an Operator', async () => {
    const operator = await signedInHttp(app, prisma);
    const res = await operator.get('/internal/users').expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('changing a Role', () => {
  it('promotes an Operator and demotes an Organization Admin', async () => {
    const { admin, operator } = await setup();
    await patchRole(admin, operator.id, 'ORGANIZATION_ADMIN').expect(200);
    expect(await roleOf(operator.id)).toBe('ORGANIZATION_ADMIN');
    await patchRole(admin, operator.id, 'OPERATOR').expect(200);
    expect(await roleOf(operator.id)).toBe('OPERATOR');
  });

  it('refuses Roles other than Operator and Organization Admin', async () => {
    const { admin, operator } = await setup();
    await patchRole(admin, operator.id, 'SUPER_ADMIN').expect(400);
  });

  it('refuses demoting the last active Organization Admin', async () => {
    const { admin } = await setup();
    const res = await patchRole(admin, admin.user.id, 'OPERATOR').expect(409);
    expect(res.body.code).toBe('LAST_ORGANIZATION_ADMIN');
    expect(await roleOf(admin.user.id)).toBe('ORGANIZATION_ADMIN');
  });

  it('allows demoting an admin when another active one remains', async () => {
    const { admin, operator } = await setup();
    await patchRole(admin, operator.id, 'ORGANIZATION_ADMIN').expect(200);
    await patchRole(admin, admin.user.id, 'OPERATOR').expect(200);
  });

  it('does not count a deactivated admin as remaining', async () => {
    const { organizationId, admin } = await setup();
    await createUser(prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId,
      active: false,
    });
    await patchRole(admin, admin.user.id, 'OPERATOR').expect(409);
  });

  it('revokes the User refresh tokens', async () => {
    const { admin, operator } = await setup();
    const session = await signInOk(app, operator);
    await patchRole(admin, operator.id, 'ORGANIZATION_ADMIN').expect(200);
    await refresh(app, session.refreshToken).expect(401);
  });

  it('refuses an Operator, and treats another Organization User as not found', async () => {
    const { organizationId, admin, operator } = await setup();
    const colleague = await signedInHttp(app, prisma, { organizationId });
    await patchRole(colleague, operator.id, 'ORGANIZATION_ADMIN').expect(403);
    expect(await roleOf(operator.id)).toBe('OPERATOR');

    const foreign = await createUser(prisma, {
      organizationId: await createOrganization(prisma, 'Foreign'),
    });
    const res = await patchRole(admin, foreign.id, 'ORGANIZATION_ADMIN').expect(
      404,
    );
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  it('is a sensitive write: refused at once once the caller is deactivated', async () => {
    const { admin, operator } = await setup();
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { active: false },
    });
    const res = await patchRole(
      admin,
      operator.id,
      'ORGANIZATION_ADMIN',
    ).expect(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });
});

describe('deactivating and reactivating', () => {
  it('deactivates: no sign-in, refresh revoked, sensitive writes refused at once', async () => {
    const { organizationId, admin } = await setup();
    const other = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId,
    });
    const session = await signInOk(app, other.user);
    await admin.post(`/internal/users/${other.user.id}/deactivate`).expect(204);

    await signIn(app, other.user).expect(403);
    await refresh(app, session.refreshToken).expect(401);
    const refused = await other
      .post(`/internal/users/${admin.user.id}/deactivate`)
      .expect(403);
    expect(refused.body.code).toBe('ACCOUNT_DEACTIVATED');
    // Reads trust the access token until it expires (ADR 0008).
    await other.get('/internal/users').expect(200);
  });

  it('refuses deactivating the last active Organization Admin', async () => {
    const { admin } = await setup();
    const res = await admin
      .post(`/internal/users/${admin.user.id}/deactivate`)
      .expect(409);
    expect(res.body.code).toBe('LAST_ORGANIZATION_ADMIN');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: admin.user.id },
    });
    expect(row.active).toBe(true);
  });

  it('reactivates a deactivated User, who can sign in again', async () => {
    const { organizationId, admin } = await setup();
    const gone = await createUser(prisma, { organizationId, active: false });
    await signIn(app, gone).expect(403);
    await admin.post(`/internal/users/${gone.id}/reactivate`).expect(204);
    await signIn(app, gone).expect(200);
  });

  it('refuses an Operator', async () => {
    const { organizationId, operator } = await setup();
    const colleague = await signedInHttp(app, prisma, { organizationId });
    await colleague
      .post(`/internal/users/${operator.id}/deactivate`)
      .expect(403);
    await colleague
      .post(`/internal/users/${operator.id}/reactivate`)
      .expect(403);
  });

  it('keeps a deactivated User listed under their name', async () => {
    const { organizationId, admin } = await setup();
    const actor = await createUser(prisma, { organizationId });
    await admin.post(`/internal/users/${actor.id}/deactivate`).expect(204);
    const listed = await admin.get('/internal/users').expect(200);
    expect(
      (listed.body.items as { id: string; name: string }[]).find(
        (u) => u.id === actor.id,
      )?.name,
    ).toBe('Test OPERATOR');
  });
});

describe('Super Admin', () => {
  it('manages Users in any Organization, including appointing an Organization Admin', async () => {
    const { organizationId, operator } = await setup();
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    const none = await superAdmin.get('/internal/users').expect(403);
    expect(none.body.code).toBe('ORGANIZATION_REQUIRED');
    const listed = await withOrg(
      superAdmin.get('/internal/users'),
      organizationId,
    ).expect(200);
    expect(listed.body.items).toHaveLength(2);

    await patchRole(
      superAdmin,
      operator.id,
      'ORGANIZATION_ADMIN',
      organizationId,
    ).expect(200);
    await withOrg(
      superAdmin.post(`/internal/users/${operator.id}/deactivate`),
      organizationId,
    ).expect(204);
    await withOrg(
      superAdmin.post(`/internal/users/${operator.id}/reactivate`),
      organizationId,
    ).expect(204);
  });

  it('recovers an Organization with no active admin by appointing one', async () => {
    const organizationId = await createOrganization(prisma, 'Orphaned');
    const operator = await createUser(prisma, { organizationId });
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    await patchRole(
      superAdmin,
      operator.id,
      'ORGANIZATION_ADMIN',
      organizationId,
    ).expect(200);
    expect(await roleOf(operator.id)).toBe('ORGANIZATION_ADMIN');
  });

  it('does not manage another Super Admin through an Organization', async () => {
    const { organizationId } = await setup();
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    const target = await createUser(prisma, { role: 'SUPER_ADMIN' });
    await withOrg(
      superAdmin.post(`/internal/users/${target.id}/deactivate`),
      organizationId,
    ).expect(404);
  });
});
