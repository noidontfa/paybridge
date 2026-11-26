import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { runSeed, SEED_PASSWORD, SEED_USERS } from '../../seed/seed.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { testDatabaseUrl } from '../setup/test-database.js';
import { createUser, refresh, signIn, signInOk } from '../setup/users.js';

// The two ways Users come into being in this ticket: the seed (development)
// and the Super Admin CLI command. Invitations come in ticket 06.

const prisma = createTestPrismaClient();
const DATABASE_URL = testDatabaseUrl();
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

describe('the seed', () => {
  it('creates a Super Admin, Organization Admins and Operators that share one development password', async () => {
    await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test' });

    const roles = new Set<string>();
    for (const seeded of SEED_USERS) {
      const res = await signIn(app, {
        email: seeded.email,
        password: SEED_PASSWORD,
      }).expect(200);
      roles.add(res.body.user.role);
      expect(res.body.user.organization === null).toBe(
        seeded.role === 'SUPER_ADMIN',
      );
    }
    expect(roles).toEqual(
      new Set(['SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'OPERATOR']),
    );
  });

  it('puts Users in at least two Organizations and can run again', async () => {
    await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test' });
    await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test' });

    const organizations = await prisma.user.findMany({
      where: { email: { in: SEED_USERS.map((u) => u.email) } },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
    expect(
      organizations.filter((o) => o.organizationId).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('the create-super-admin command', () => {
  const run = (args: string[], password?: string) =>
    spawnSync('pnpm', ['exec', 'tsx', 'cli/create-super-admin.ts', ...args], {
      cwd: join(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL,
        ...(password && { SUPER_ADMIN_PASSWORD: password }),
      },
      encoding: 'utf8',
    });
  const uniqueEmail = () =>
    `root-${Math.random().toString(36).slice(2)}@paybridge.test`;

  it('creates a Super Admin who can sign in, even when Super Admins already exist', async () => {
    await createUser(prisma, { role: 'SUPER_ADMIN' });
    const email = uniqueEmail();

    const result = run(
      ['--email', email, '--name', 'Root'],
      'a-long-enough-password',
    );

    expect(result.status, result.stderr).toBe(0);
    const res = await signIn(app, {
      email,
      password: 'a-long-enough-password',
    }).expect(200);
    expect(res.body.user).toMatchObject({
      name: 'Root',
      role: 'SUPER_ADMIN',
      organization: null,
    });
  });

  it('refuses a password shorter than 12 characters', async () => {
    const email = uniqueEmail();

    const result = run(['--email', email], 'too-short');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('at least 12');
    await signIn(app, { email, password: 'too-short' }).expect(401);
  });

  it('recovers an existing Super Admin: new password, active, signed out everywhere', async () => {
    const admin = await createUser(prisma, { role: 'SUPER_ADMIN' });
    const before = await signInOk(app, admin);
    await prisma.user.update({
      where: { id: admin.id },
      data: { active: false },
    });

    const result = run(['--email', admin.email], 'brand-new-password-1');

    expect(result.status, result.stderr).toBe(0);
    await signIn(app, admin).expect(401);
    await signIn(app, {
      email: admin.email,
      password: 'brand-new-password-1',
    }).expect(200);
    await refresh(app, before.refreshToken).expect(401);
  });

  it('refuses an email that belongs to an Operator', async () => {
    const operator = await createUser(prisma, { role: 'OPERATOR' });

    const result = run(['--email', operator.email], 'a-long-enough-password');

    expect(result.status).toBe(1);
    await signIn(app, {
      email: operator.email,
      password: 'a-long-enough-password',
    }).expect(401);
  });
});
