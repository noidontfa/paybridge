import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { IdentityClock } from '../../src/identity/port/clock.js';
import { createOrganization } from '../setup/organizations.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import {
  createUser,
  refresh,
  signIn,
  signInOk,
  TEST_PASSWORD,
} from '../setup/users.js';

// Sign-in, tokens, refresh rotation, reuse detection and sign-out, over HTTP
// against real PostgreSQL (ADR 0008).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const prisma = createTestPrismaClient();
let now = new Date('2026-06-01T09:00:00.000Z');
const clock: IdentityClock = { now: () => now };
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IdentityClock)
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

beforeEach(() => {
  now = new Date('2026-06-01T09:00:00.000Z');
});

const http = () => request(app.getHttpServer());
const me = (accessToken: string) =>
  http().get('/internal/auth/me').set('Authorization', `Bearer ${accessToken}`);

/** Reads the (unverified) claims of a JWT, as a reader of the token would. */
function claimsOf(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString());
}

describe('sign-in', () => {
  it('signs an Operator in and answers with the User, Role and Organization', async () => {
    const user = await createUser(prisma, { role: 'OPERATOR' });

    const res = await signIn(app, user).expect(200);

    expect(res.body).toMatchObject({
      expiresIn: 300,
      user: {
        id: user.id,
        email: user.email,
        role: 'OPERATOR',
        organization: { id: user.organizationId, name: 'Default Organization' },
      },
    });
    expect(res.body.user.permissions).toContain('reviews:resolve');
    expect(res.body.user.permissions).not.toContain('users:manage');
  });

  it('issues an ES256 access token valid for 5 minutes with the User, Role, Organization and Permissions', async () => {
    const user = await createUser(prisma, { role: 'ORGANIZATION_ADMIN' });

    const { accessToken } = await signInOk(app, user);

    const header = JSON.parse(
      Buffer.from(accessToken.split('.')[0]!, 'base64url').toString(),
    );
    expect(header).toMatchObject({ alg: 'ES256', typ: 'JWT' });
    const claims = claimsOf(accessToken);
    expect(claims).toMatchObject({
      sub: user.id,
      role: 'ORGANIZATION_ADMIN',
      org: user.organizationId,
    });
    expect(claims.permissions).toContain('users:manage');
    expect((claims.exp as number) - (claims.iat as number)).toBe(300);
  });

  it('signs a Super Admin in with no Organization', async () => {
    const user = await createUser(prisma, { role: 'SUPER_ADMIN' });

    const res = await signIn(app, user).expect(200);

    expect(res.body.user).toMatchObject({
      role: 'SUPER_ADMIN',
      organization: null,
    });
    expect(claimsOf(res.body.accessToken)).not.toHaveProperty('org');
  });

  it('ignores the case of the email address', async () => {
    const user = await createUser(prisma);

    await signIn(app, { ...user, email: user.email.toUpperCase() }).expect(200);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const user = await createUser(prisma);

    const wrongPassword = await signIn(app, {
      email: user.email,
      password: 'not-the-password',
    }).expect(401);
    const unknownEmail = await signIn(app, {
      email: 'nobody@paybridge.test',
      password: TEST_PASSWORD,
    }).expect(401);

    const strip = ({ body }: { body: Record<string, unknown> }) => {
      const { timestamp: _t, requestId: _r, ...rest } = body;
      return rest;
    };
    expect(strip(unknownEmail)).toEqual(strip(wrongPassword));
    expect(unknownEmail.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a deactivated User', async () => {
    const user = await createUser(prisma, { active: false });

    const res = await signIn(app, user).expect(403);

    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('refuses a User of a suspended Organization', async () => {
    const organizationId = await createOrganization(prisma, 'Suspended Org');
    const user = await createUser(prisma, { organizationId });
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'SUSPENDED' },
    });

    const res = await signIn(app, user).expect(403);

    expect(res.body.code).toBe('ORGANIZATION_SUSPENDED');
  });

  it('does not reveal a deactivated account to someone who lacks the password', async () => {
    const user = await createUser(prisma, { active: false });

    const res = await signIn(app, {
      email: user.email,
      password: 'nope-nope-nope',
    });

    expect(res.status).toBe(401);
  });
});

describe('the principal', () => {
  it('refuses an operator route without a valid access token', async () => {
    await http().get('/internal/payments').expect(401);
    await http()
      .get('/internal/payments')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    await http()
      .post(
        '/internal/payments/00000000-0000-7000-8000-000000000009/review-resolution',
      )
      .send({})
      .expect(401);
  });

  it('refuses a token with a forged signature', async () => {
    const user = await createUser(prisma);
    const { accessToken } = await signInOk(app, user);
    const [header, payload] = accessToken.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claimsOf(accessToken), role: 'SUPER_ADMIN' }),
    ).toString('base64url');

    const res = await http()
      .get('/internal/payments')
      .set('Authorization', `Bearer ${header}.${forgedPayload}.${payload}`);

    expect(res.status).toBe(401);
  });

  it('refuses an expired access token', async () => {
    const user = await createUser(prisma);
    const { accessToken } = await signInOk(app, user);

    now = new Date(now.getTime() + 5 * MINUTE + 1000);

    await me(accessToken).expect(401);
  });

  it('accepts the access token on operator routes and scopes them to its Organization', async () => {
    const user = await createUser(prisma);
    const { accessToken } = await signInOk(app, user);

    const res = await me(accessToken).expect(200);

    expect(res.body).toMatchObject({ id: user.id, role: 'OPERATOR' });
    await http()
      .get('/internal/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('asks a Super Admin, who has no Organization, to choose one', async () => {
    const user = await createUser(prisma, { role: 'SUPER_ADMIN' });
    const { accessToken } = await signInOk(app, user);

    const res = await http()
      .get('/internal/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
  });

  it('publishes the public key as a JWKS that verifies the access token', async () => {
    const res = await http().get('/.well-known/jwks.json').expect(200);

    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({
      kty: 'EC',
      crv: 'P-256',
      alg: 'ES256',
      use: 'sig',
    });
    expect(res.body.keys[0]).not.toHaveProperty('d');
    const user = await createUser(prisma);
    const { accessToken } = await signInOk(app, user);
    const header = JSON.parse(
      Buffer.from(accessToken.split('.')[0]!, 'base64url').toString(),
    );
    expect(header.kid).toBe(res.body.keys[0].kid);
  });
});

describe('refresh', () => {
  it('trades a refresh token for a new session and spends the old token', async () => {
    const user = await createUser(prisma);
    const first = await signInOk(app, user);

    const res = await refresh(app, first.refreshToken).expect(200);

    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.user).toMatchObject({ id: user.id, role: 'OPERATOR' });
    await me(res.body.accessToken).expect(200);
  });

  it('keeps a User signed in while they keep working, up to 7 days', async () => {
    const user = await createUser(prisma);
    let tokens = await signInOk(app, user);

    for (let day = 1; day <= 6; day++) {
      now = new Date(now.getTime() + 23 * HOUR);
      tokens = (await refresh(app, tokens.refreshToken).expect(200))
        .body as typeof tokens;
    }
    // 6 x 23h = 138h. The 7 days (168h) since sign-in are not over yet.
    now = new Date(now.getTime() + 23 * HOUR);
    tokens = (await refresh(app, tokens.refreshToken).expect(200))
      .body as typeof tokens;

    // 161h + 23h = 184h > 168h: past the 7 days, whatever the activity.
    now = new Date(now.getTime() + 23 * HOUR);
    const res = await refresh(app, tokens.refreshToken).expect(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('signs a User out after 24 hours without activity', async () => {
    const user = await createUser(prisma);
    const { refreshToken } = await signInOk(app, user);

    now = new Date(now.getTime() + 24 * HOUR + 1000);

    await refresh(app, refreshToken).expect(401);
  });

  it('revokes the whole family when a used refresh token is presented again', async () => {
    const user = await createUser(prisma);
    const first = await signInOk(app, user);
    const second = (await refresh(app, first.refreshToken).expect(200)).body;

    await refresh(app, first.refreshToken).expect(401);

    // The thief's replay also killed the newest token of the family.
    await refresh(app, second.refreshToken).expect(401);
  });

  it('keeps other sign-ins of the same User alive when one family is revoked', async () => {
    const user = await createUser(prisma);
    const laptop = await signInOk(app, user);
    const phone = await signInOk(app, user);
    await refresh(app, laptop.refreshToken).expect(200);
    await refresh(app, laptop.refreshToken).expect(401);

    await refresh(app, phone.refreshToken).expect(200);
  });

  it('refuses an unknown refresh token', async () => {
    await refresh(app, 'never-issued').expect(401);
  });

  it('refuses to refresh once the User is deactivated', async () => {
    const user = await createUser(prisma);
    const { refreshToken } = await signInOk(app, user);
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });

    await refresh(app, refreshToken).expect(401);
  });

  it('refuses to refresh once the Organization is suspended', async () => {
    const organizationId = await createOrganization(prisma, 'Soon suspended');
    const user = await createUser(prisma, { organizationId });
    const { refreshToken } = await signInOk(app, user);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'SUSPENDED' },
    });

    await refresh(app, refreshToken).expect(401);
  });
});

describe('sign-out', () => {
  it('revokes the refresh token, so it cannot be refreshed any more', async () => {
    const user = await createUser(prisma);
    const { refreshToken } = await signInOk(app, user);

    await http()
      .post('/internal/auth/sign-out')
      .send({ refreshToken })
      .expect(204);

    await refresh(app, refreshToken).expect(401);
  });

  it('revokes the newest token of the sign-in too, after a rotation', async () => {
    const user = await createUser(prisma);
    const first = await signInOk(app, user);
    const second = (await refresh(app, first.refreshToken).expect(200)).body;

    await http()
      .post('/internal/auth/sign-out')
      .send({ refreshToken: second.refreshToken })
      .expect(204);

    await refresh(app, second.refreshToken).expect(401);
  });

  it('answers 204 for a token it does not know', async () => {
    await http()
      .post('/internal/auth/sign-out')
      .send({ refreshToken: 'never-issued' })
      .expect(204);
  });
});
