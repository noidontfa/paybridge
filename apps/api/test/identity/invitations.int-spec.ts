import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { RecordingEmailSender } from '../../src/identity/infrastructure/email/recording-email-sender.js';
import { IdentityClock } from '../../src/identity/domain/services/clock.js';
import { EmailSender } from '../../src/identity/domain/services/email-sender.js';
import { createOrganization } from '../setup/organizations.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import {
  createUser,
  signIn,
  signInOk,
  type TestUser,
} from '../setup/users.js';

// Invitations over HTTP against real PostgreSQL. The link is read from the
// recording email adapter, as an invitee would read it from their inbox.

const DAY = 24 * 60 * 60_000;
const NEW_PASSWORD = 'my-own-new-password';

const prisma = createTestPrismaClient();
const emails = new RecordingEmailSender();
let now = new Date('2026-06-01T09:00:00.000Z');
const clock: IdentityClock = { now: () => now };
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IdentityClock)
    .useValue(clock)
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

beforeEach(async () => {
  now = new Date('2026-06-01T09:00:00.000Z');
  emails.sent.length = 0;
  await prisma.invitation.deleteMany();
});

const server = () => app.getHttpServer();

interface Caller {
  readonly user: TestUser;
  readonly auth: string;
  readonly organization?: string;
}

async function caller(
  options: Parameters<typeof createUser>[1] = {},
  organization?: string,
): Promise<Caller> {
  const user = await createUser(prisma, options);
  const { accessToken } = await signInOk(app, user);
  return { user, auth: `Bearer ${accessToken}`, organization };
}

function as(c: Caller, req: request.Test): request.Test {
  req.set('Authorization', c.auth);
  if (c.organization) req.set('X-Organization-Id', c.organization);
  return req;
}
const invite = (c: Caller, email: string, role: string) =>
  as(c, request(server()).post('/internal/invitations')).send({ email, role });
const list = (c: Caller) =>
  as(c, request(server()).get('/internal/invitations'));
const resend = (c: Caller, id: string) =>
  as(c, request(server()).post(`/internal/invitations/${id}/resend`));
const revoke = (c: Caller, id: string) =>
  as(c, request(server()).delete(`/internal/invitations/${id}`));
const accept = (token: string, name = 'Newcomer', password = NEW_PASSWORD) =>
  request(server())
    .post('/internal/auth/invitations/accept')
    .send({ token, name, password });

function lastToken(): string {
  const email = emails.sent.at(-1);
  if (!email) throw new Error('no email was sent');
  const token = new URL(email.link).searchParams.get('token');
  if (!token) throw new Error(`no token in ${email.link}`);
  return token;
}

let seq = 0;
const freshEmail = () => `invitee-${Date.now()}-${seq++}@paybridge.test`;

describe('sending an Invitation', () => {
  it('lets an Organization Admin invite an Operator into their Organization', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const email = freshEmail();

    const res = await invite(admin, email, 'OPERATOR').expect(201);

    expect(res.body).toMatchObject({ email, role: 'OPERATOR' });
    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]!.to).toBe(email);
    expect(emails.sent[0]!.link).toContain('/accept-invitation?token=');
    const row = await prisma.invitation.findFirstOrThrow({ where: { email } });
    expect(row.organizationId).toBe(admin.user.organizationId);
    expect(row.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it('stores only a hash of the link token', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const row = await prisma.invitation.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(lastToken());
    expect(JSON.stringify(row)).not.toContain(lastToken());
  });

  it('lets an Organization Admin invite another Organization Admin', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'ORGANIZATION_ADMIN').expect(201);
  });

  it('lets a Super Admin invite into any chosen Organization', async () => {
    const orgId = await createOrganization(prisma);
    const superAdmin = await caller({ role: 'SUPER_ADMIN' }, orgId);
    const email = freshEmail();
    await invite(superAdmin, email, 'ORGANIZATION_ADMIN').expect(201);
    const row = await prisma.invitation.findFirstOrThrow({ where: { email } });
    expect(row.organizationId).toBe(orgId);
  });

  it('refuses a Super Admin who chose no Organization', async () => {
    const superAdmin = await caller({ role: 'SUPER_ADMIN' });
    await invite(superAdmin, freshEmail(), 'OPERATOR').expect(400);
  });

  it('lets a Super Admin invite another Super Admin', async () => {
    const superAdmin = await caller({ role: 'SUPER_ADMIN' });
    const email = freshEmail();
    await invite(superAdmin, email, 'SUPER_ADMIN').expect(201);
    const row = await prisma.invitation.findFirstOrThrow({ where: { email } });
    expect(row.organizationId).toBeNull();
  });

  it('refuses an Operator', async () => {
    const operator = await caller({ role: 'OPERATOR' });
    await invite(operator, freshEmail(), 'OPERATOR').expect(403);
    expect(emails.sent).toHaveLength(0);
  });

  it('refuses an Organization Admin inviting a Super Admin', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'SUPER_ADMIN').expect(403);
  });

  it('refuses an email that already belongs to a User', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const existing = await createUser(prisma);
    const res = await invite(
      admin,
      existing.email.toUpperCase(),
      'OPERATOR',
    ).expect(409);
    expect(res.body).toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(emails.sent).toHaveLength(0);
  });

  it('refuses a second pending Invitation for the same email', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const email = freshEmail();
    await invite(admin, email, 'OPERATOR').expect(201);
    const res = await invite(admin, email, 'OPERATOR').expect(409);
    expect(res.body).toMatchObject({ code: 'INVITATION_PENDING' });
  });

  it('refuses a deactivated Organization Admin at once (sensitive write)', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { active: false },
    });
    await invite(admin, freshEmail(), 'OPERATOR').expect(403);
  });
});

describe('accepting an Invitation', () => {
  it('creates an active User with the Role and Organization, who can sign in', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const email = freshEmail();
    await invite(admin, email, 'ORGANIZATION_ADMIN').expect(201);

    await accept(lastToken(), 'Nora Newcomer').expect(204);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({
      name: 'Nora Newcomer',
      role: 'ORGANIZATION_ADMIN',
      organizationId: admin.user.organizationId,
      active: true,
    });
    await signIn(app, { email, password: NEW_PASSWORD }).expect(200);
  });

  it('creates a Super Admin without an Organization', async () => {
    const superAdmin = await caller({ role: 'SUPER_ADMIN' });
    const email = freshEmail();
    await invite(superAdmin, email, 'SUPER_ADMIN').expect(201);
    await accept(lastToken()).expect(204);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: 'SUPER_ADMIN', organizationId: null });
  });

  it('refuses a password shorter than 12 characters and keeps the link usable', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const token = lastToken();
    const res = await accept(token, 'Nora', 'short').expect(400);
    expect(res.body).toMatchObject({ code: 'WEAK_PASSWORD' });
    await accept(token).expect(204);
  });

  it('works only once', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const token = lastToken();
    await accept(token).expect(204);
    const res = await accept(token).expect(400);
    expect(res.body).toMatchObject({ code: 'INVALID_INVITATION_TOKEN' });
  });

  it('refuses an unknown token', async () => {
    await accept('not-a-real-token').expect(400);
  });

  it('expires after 7 days', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const token = lastToken();
    now = new Date(now.getTime() + 7 * DAY + 1000);
    await accept(token).expect(400);
  });

  it('is still valid just before 7 days', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const token = lastToken();
    now = new Date(now.getTime() + 7 * DAY - 1000);
    await accept(token).expect(204);
  });

  it('refuses when the email became a User in the meantime', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const email = freshEmail();
    await invite(admin, email, 'OPERATOR').expect(201);
    await prisma.user.create({
      data: {
        email,
        name: 'Taken',
        passwordHash: 'x',
        role: 'OPERATOR',
        organizationId: admin.user.organizationId,
        id: crypto.randomUUID(),
      },
    });
    await accept(lastToken()).expect(409);
  });
});

describe('re-sending an Invitation', () => {
  it('voids the previous link and emails a new one', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const oldToken = lastToken();

    await resend(admin, created.body.id as string).expect(204);
    const newToken = lastToken();

    expect(emails.sent).toHaveLength(2);
    expect(newToken).not.toBe(oldToken);
    await accept(oldToken).expect(400);
    await accept(newToken).expect(204);
  });

  it('restarts the 7 days', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    now = new Date(now.getTime() + 6 * DAY);
    const later = await caller({ role: 'ORGANIZATION_ADMIN' });
    await resend(later, created.body.id as string).expect(204);
    const row = await prisma.invitation.findFirstOrThrow();
    expect(row.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it("refuses another Organization's Invitation as not found", async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const other = await caller({
      role: 'ORGANIZATION_ADMIN',
      organizationId: await createOrganization(prisma),
    });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    await resend(other, created.body.id as string).expect(404);
  });

  it('refuses an Operator', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const operator = await caller({ role: 'OPERATOR' });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    await resend(operator, created.body.id as string).expect(403);
  });
});

describe('revoking an Invitation', () => {
  it('stops its link working and removes it from the pending list', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    const token = lastToken();

    await revoke(admin, created.body.id as string).expect(204);

    await accept(token).expect(400);
    const res = await list(admin).expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('refuses an Operator', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const operator = await caller({ role: 'OPERATOR' });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    await revoke(operator, created.body.id as string).expect(403);
  });

  it('refuses an Invitation that was already accepted', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const created = await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    await accept(lastToken()).expect(204);
    await revoke(admin, created.body.id as string).expect(404);
  });
});

describe('listing pending Invitations', () => {
  it('shows email, Role and expiry of this Organization only', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    const other = await caller({
      role: 'ORGANIZATION_ADMIN',
      organizationId: await createOrganization(prisma),
    });
    const mine = freshEmail();
    await invite(admin, mine, 'OPERATOR').expect(201);
    await invite(other, freshEmail(), 'OPERATOR').expect(201);

    const res = await list(admin).expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      email: mine,
      role: 'OPERATOR',
      expiresAt: new Date(now.getTime() + 7 * DAY).toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  });

  it('omits accepted and expired Invitations', async () => {
    const admin = await caller({ role: 'ORGANIZATION_ADMIN' });
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    await accept(lastToken()).expect(204);
    await invite(admin, freshEmail(), 'OPERATOR').expect(201);
    now = new Date(now.getTime() + 8 * DAY);
    const fresh = await caller({ role: 'ORGANIZATION_ADMIN' });
    const res = await list(fresh).expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('refuses an Operator', async () => {
    const operator = await caller({ role: 'OPERATOR' });
    await list(operator).expect(403);
  });
});
