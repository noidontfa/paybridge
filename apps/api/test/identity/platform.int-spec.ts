import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { RecordingEmailSender } from '../../src/identity/infrastructure/email/recording-email-sender.js';
import { EmailSender } from '../../src/identity/port/email-sender.js';
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

// Ticket 12: the Platform area over HTTP on real PostgreSQL.

const prisma = createTestPrismaClient();
const emails = new RecordingEmailSender();
let app: INestApplication;
let seq = 0;
const freshEmail = () => `invitee-${Date.now()}-${seq++}@paybridge.test`;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailSender)
    .useValue(emails)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(() => {
  emails.sent.length = 0;
});

const superAdmin = () => signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
const orgStatus = async (id: string) =>
  (await prisma.organization.findUniqueOrThrow({ where: { id } })).status;
const lastToken = () =>
  new URL(emails.sent.at(-1)!.link).searchParams.get('token');

describe('creating an Organization', () => {
  it('creates it active, with an Invitation for its first Organization Admin', async () => {
    const sa = await superAdmin();
    const email = freshEmail();

    const res = await sa
      .post('/internal/organizations')
      .send({ name: 'Brand New Co', adminEmail: email })
      .expect(201);

    expect(res.body).toMatchObject({ name: 'Brand New Co', status: 'ACTIVE' });
    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { email },
    });
    expect(invitation).toMatchObject({
      role: 'ORGANIZATION_ADMIN',
      organizationId: res.body.id,
    });
    expect(emails.sent.at(-1)?.to).toBe(email);
  });

  it('lets the invited admin accept and sign in', async () => {
    const sa = await superAdmin();
    const email = freshEmail();
    await sa
      .post('/internal/organizations')
      .send({ name: 'Accepting Co', adminEmail: email })
      .expect(201);
    await request(app.getHttpServer())
      .post('/internal/auth/invitations/accept')
      .send({
        token: lastToken(),
        name: 'First Admin',
        password: 'my-own-new-password',
      })
      .expect(204);
    await signIn(app, { email, password: 'my-own-new-password' }).expect(200);
  });

  it('refuses an email that already has a User, creating nothing', async () => {
    const sa = await superAdmin();
    const existing = await createUser(prisma);
    const before = await prisma.organization.count();
    await sa
      .post('/internal/organizations')
      .send({ name: 'Nope Co', adminEmail: existing.email })
      .expect(409);
    expect(await prisma.organization.count()).toBe(before);
  });

  it('refuses a blank name', async () => {
    const sa = await superAdmin();
    await sa
      .post('/internal/organizations')
      .send({ name: ' ', adminEmail: freshEmail() })
      .expect(400);
  });

  it('is refused to an Organization Admin', async () => {
    const admin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
    });
    await admin
      .post('/internal/organizations')
      .send({ name: 'Sneaky', adminEmail: freshEmail() })
      .expect(403);
  });
});

describe('suspending and reactivating an Organization', () => {
  async function setup() {
    const organizationId = await createOrganization(prisma, 'Suspendable');
    const admin = await createUser(prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId,
    });
    const session = await signInOk(app, admin);
    return { organizationId, admin, session, sa: await superAdmin() };
  }

  it('suspends: sign-in, refresh and sensitive writes are refused at once', async () => {
    const { organizationId, admin, session, sa } = await setup();

    await sa
      .post(`/internal/organizations/${organizationId}/suspend`)
      .expect(204);

    expect(await orgStatus(organizationId)).toBe('SUSPENDED');
    const signInRes = await signIn(app, admin).expect(403);
    expect(signInRes.body.code).toBe('ORGANIZATION_SUSPENDED');
    await refresh(app, session.refreshToken).expect(401);
    const write = await request(app.getHttpServer())
      .post('/internal/invitations')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ email: freshEmail(), role: 'OPERATOR' })
      .expect(403);
    expect(write.body.code).toBe('ORGANIZATION_SUSPENDED');
  });

  it('reactivates: the Users can sign in again', async () => {
    const { organizationId, admin, sa } = await setup();
    await sa
      .post(`/internal/organizations/${organizationId}/suspend`)
      .expect(204);
    await sa
      .post(`/internal/organizations/${organizationId}/reactivate`)
      .expect(204);
    expect(await orgStatus(organizationId)).toBe('ACTIVE');
    await signIn(app, admin).expect(200);
  });

  it('lists Organizations with their status', async () => {
    const { organizationId, sa } = await setup();
    await sa
      .post(`/internal/organizations/${organizationId}/suspend`)
      .expect(204);
    const res = await sa.get('/internal/organizations').expect(200);
    expect(res.body.items).toContainEqual(
      expect.objectContaining({ id: organizationId, status: 'SUSPENDED' }),
    );
  });

  it('answers 404 for an unknown Organization', async () => {
    const sa = await superAdmin();
    await sa
      .post(
        '/internal/organizations/00000000-0000-4000-8000-0000000000aa/suspend',
      )
      .expect(404);
  });

  it('is refused to an Organization Admin and an Operator', async () => {
    const { organizationId, admin } = await setup();
    const { accessToken } = await signInOk(app, admin);
    await request(app.getHttpServer())
      .post(`/internal/organizations/${organizationId}/suspend`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    const operator = await signedInHttp(app, prisma, { organizationId });
    await operator
      .post(`/internal/organizations/${organizationId}/suspend`)
      .expect(403);
    expect(await orgStatus(organizationId)).toBe('ACTIVE');
  });
});

describe('managing Super Admins', () => {
  /** Two active Super Admins and nobody else, so the last-one guard is exact. */
  async function pair(): Promise<{ a: SignedInHttp; b: SignedInHttp }> {
    const a = await superAdmin();
    const b = await superAdmin();
    await prisma.user.updateMany({
      where: {
        role: 'SUPER_ADMIN',
        id: { notIn: [a.user.id, b.user.id] },
      },
      data: { active: false },
    });
    return { a, b };
  }

  it('lists Super Admins with their active state', async () => {
    const { a, b } = await pair();
    const res = await a.get('/internal/super-admins').expect(200);
    const ids = (res.body.items as { id: string }[]).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([a.user.id, b.user.id]));
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('invites another Super Admin, who can accept and sign in', async () => {
    const { a } = await pair();
    const email = freshEmail();
    await a
      .post('/internal/super-admins/invitations')
      .send({ email })
      .expect(201);
    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { email },
    });
    expect(invitation).toMatchObject({
      role: 'SUPER_ADMIN',
      organizationId: null,
    });
    await request(app.getHttpServer())
      .post('/internal/auth/invitations/accept')
      .send({
        token: lastToken(),
        name: 'Second SA',
        password: 'my-own-new-password',
      })
      .expect(204);
    await signIn(app, { email, password: 'my-own-new-password' }).expect(200);
  });

  it('deactivates and reactivates a Super Admin, revoking their sessions', async () => {
    const { a, b } = await pair();
    const session = await signInOk(app, b.user);

    await a.post(`/internal/super-admins/${b.user.id}/deactivate`).expect(204);
    await signIn(app, b.user).expect(403);
    await refresh(app, session.refreshToken).expect(401);

    await a.post(`/internal/super-admins/${b.user.id}/reactivate`).expect(204);
    await signIn(app, b.user).expect(200);
  });

  it('refuses deactivating the last active Super Admin', async () => {
    const { a, b } = await pair();
    await a.post(`/internal/super-admins/${b.user.id}/deactivate`).expect(204);

    const res = await a
      .post(`/internal/super-admins/${a.user.id}/deactivate`)
      .expect(409);

    expect(res.body.code).toBe('LAST_SUPER_ADMIN');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } }))
        .active,
    ).toBe(true);
  });

  it('does not let two Super Admins deactivate each other at once', async () => {
    const { a, b } = await pair();
    const results = await Promise.all([
      a.post(`/internal/super-admins/${b.user.id}/deactivate`),
      b.post(`/internal/super-admins/${a.user.id}/deactivate`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
  });

  it('cannot change a Super Admin Role', async () => {
    const { a, b } = await pair();
    await a
      .post(`/internal/super-admins/${b.user.id}/role`)
      .send({ role: 'OPERATOR' })
      .expect(404);
    const orgId = await createOrganization(prisma, 'Roles');
    const res = await request(app.getHttpServer())
      .post(`/internal/users/${b.user.id}/role`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .set('X-Organization-Id', orgId)
      .send({ role: 'OPERATOR' });
    expect(res.status).toBe(404);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).role,
    ).toBe('SUPER_ADMIN');
  });

  it('answers 404 for a User who is not a Super Admin', async () => {
    const { a } = await pair();
    const operator = await createUser(prisma);
    await a
      .post(`/internal/super-admins/${operator.id}/deactivate`)
      .expect(404);
  });

  it('is refused to an Organization Admin', async () => {
    const admin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
    });
    await admin.get('/internal/super-admins').expect(403);
    await admin
      .post('/internal/super-admins/invitations')
      .send({ email: freshEmail() })
      .expect(403);
  });
});
