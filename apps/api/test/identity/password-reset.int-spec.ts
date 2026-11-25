import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { RecordingEmailSender } from '../../src/identity/infrastructure/email/recording-email-sender.js';
import { IdentityClock } from '../../src/identity/port/clock.js';
import { EmailSender } from '../../src/identity/port/email-sender.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import {
  createUser,
  refresh,
  signIn,
  signInOk,
  TEST_PASSWORD,
} from '../setup/users.js';

// Password Reset and change password, over HTTP against real PostgreSQL. The
// link is read from the recording email adapter, as a person would read it
// from their inbox.

const MINUTE = 60_000;
const NEW_PASSWORD = 'a-brand-new-password';

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

beforeEach(() => {
  now = new Date('2026-06-01T09:00:00.000Z');
  emails.sent.length = 0;
});

const http = () => request(app.getHttpServer());
const requestReset = (email: string) =>
  http().post('/internal/auth/password-reset/request').send({ email });
const completeReset = (token: string, password: string) =>
  http()
    .post('/internal/auth/password-reset/complete')
    .send({ token, password });
const changePassword = (
  accessToken: string,
  body: { currentPassword: string; newPassword: string; refreshToken?: string },
) =>
  http()
    .post('/internal/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

/** The token in the most recent email's link, as the Console's page reads it. */
function lastToken(): string {
  const email = emails.sent.at(-1);
  if (!email) throw new Error('no email was sent');
  const token = new URL(email.link).searchParams.get('token');
  if (!token) throw new Error(`no token in ${email.link}`);
  return token;
}

describe('requesting a Password Reset', () => {
  it('emails a link to a known, active User', async () => {
    const user = await createUser(prisma);

    await requestReset(user.email).expect(202);

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]).toMatchObject({ to: user.email });
    expect(emails.sent[0]!.link).toMatch(/\/reset-password\?token=.+/);
  });

  it('answers an unknown email exactly as a known one and sends nothing', async () => {
    const user = await createUser(prisma);
    const known = await requestReset(user.email);
    emails.sent.length = 0;

    const unknown = await requestReset('nobody@paybridge.test');

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(emails.sent).toHaveLength(0);
  });

  it('sends nothing to a deactivated User', async () => {
    const user = await createUser(prisma, { active: false });

    await requestReset(user.email).expect(202);

    expect(emails.sent).toHaveLength(0);
  });

  it('matches the email regardless of case and surrounding spaces', async () => {
    const user = await createUser(prisma);

    await requestReset(`  ${user.email.toUpperCase()} `).expect(202);

    expect(emails.sent).toHaveLength(1);
  });

  it('stores only a hash of the token', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    const token = lastToken();

    const rows = await prisma.passwordReset.findMany({
      where: { userId: user.id },
    });

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it('voids the previous link when a new one is requested', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    const first = lastToken();
    await requestReset(user.email).expect(202);
    const second = lastToken();

    await completeReset(first, NEW_PASSWORD).expect(400);
    await completeReset(second, NEW_PASSWORD).expect(204);
  });
});

describe('completing a Password Reset', () => {
  it('sets the new password: the old one stops working and the new one signs in', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);

    await completeReset(lastToken(), NEW_PASSWORD).expect(204);

    await signIn(app, user).expect(401);
    await signIn(app, { email: user.email, password: NEW_PASSWORD }).expect(
      200,
    );
  });

  it('works only once', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    const token = lastToken();
    await completeReset(token, NEW_PASSWORD).expect(204);

    const again = await completeReset(token, 'another-new-password!');

    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_RESET_TOKEN');
    await signIn(app, { email: user.email, password: NEW_PASSWORD }).expect(
      200,
    );
  });

  it('expires after 30 minutes', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    const token = lastToken();

    now = new Date(now.getTime() + 30 * MINUTE + 1);
    const res = await completeReset(token, NEW_PASSWORD);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RESET_TOKEN');
    await signIn(app, user).expect(200);
  });

  it('still works just inside the 30 minutes', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    const token = lastToken();

    now = new Date(now.getTime() + 29 * MINUTE);

    await completeReset(token, NEW_PASSWORD).expect(204);
  });

  it('refuses a token it never issued', async () => {
    const res = await completeReset('not-a-real-token', NEW_PASSWORD);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('refuses a password shorter than 12 characters and keeps the link usable', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    const token = lastToken();

    const res = await completeReset(token, 'short-pass1');

    expect(res.status).toBe(400);
    await signIn(app, user).expect(200);
    await completeReset(token, NEW_PASSWORD).expect(204);
  });

  it('revokes every refresh token of the User', async () => {
    const user = await createUser(prisma);
    const first = await signInOk(app, user);
    const second = await signInOk(app, user);
    await requestReset(user.email).expect(202);

    await completeReset(lastToken(), NEW_PASSWORD).expect(204);

    await refresh(app, first.refreshToken).expect(401);
    await refresh(app, second.refreshToken).expect(401);
  });

  it('does not touch another User', async () => {
    const user = await createUser(prisma);
    const other = await createUser(prisma);
    const otherSession = await signInOk(app, other);
    await requestReset(user.email).expect(202);

    await completeReset(lastToken(), NEW_PASSWORD).expect(204);

    await refresh(app, otherSession.refreshToken).expect(200);
    await signIn(app, other).expect(200);
  });

  it('cannot be used once the User has been deactivated', async () => {
    const user = await createUser(prisma);
    await requestReset(user.email).expect(202);
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });

    await completeReset(lastToken(), NEW_PASSWORD).expect(400);
  });
});

describe('changing the password while signed in', () => {
  it('changes it when the current password is given, and revokes the other sign-ins', async () => {
    const user = await createUser(prisma);
    const here = await signInOk(app, user);
    const elsewhere = await signInOk(app, user);

    await changePassword(here.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      refreshToken: here.refreshToken,
    }).expect(204);

    await refresh(app, elsewhere.refreshToken).expect(401);
    await refresh(app, here.refreshToken).expect(200);
    await signIn(app, user).expect(401);
    await signIn(app, { email: user.email, password: NEW_PASSWORD }).expect(
      200,
    );
  });

  it('revokes every sign-in when the caller names no session to keep', async () => {
    const user = await createUser(prisma);
    const here = await signInOk(app, user);

    await changePassword(here.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(204);

    await refresh(app, here.refreshToken).expect(401);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const user = await createUser(prisma);
    const here = await signInOk(app, user);
    const elsewhere = await signInOk(app, user);

    const res = await changePassword(here.accessToken, {
      currentPassword: 'not-my-password!',
      newPassword: NEW_PASSWORD,
      refreshToken: here.refreshToken,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
    await refresh(app, elsewhere.refreshToken).expect(200);
    await signIn(app, user).expect(200);
  });

  it('refuses a new password shorter than 12 characters', async () => {
    const user = await createUser(prisma);
    const here = await signInOk(app, user);

    const res = await changePassword(here.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'too-short',
    });

    expect(res.status).toBe(400);
    await signIn(app, user).expect(200);
  });

  it('needs a signed-in User', async () => {
    await http()
      .post('/internal/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('is refused for a User who has been deactivated since signing in', async () => {
    const user = await createUser(prisma);
    const here = await signInOk(app, user);
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });

    await changePassword(here.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(403);
  });
});
