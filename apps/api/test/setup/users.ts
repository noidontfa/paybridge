import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { Argon2PasswordHasher } from '../../src/identity/infrastructure/crypto/argon2-password-hasher.js';
import type { UserRole } from '../../src/identity/domain/entities/user.js';
import { DEFAULT_ORGANIZATION_ID } from './organizations.js';

/** The password every test User has (12 characters or more). */
export const TEST_PASSWORD = 'correct-horse-battery';

// Hashing is deliberately slow; every test User shares one hash.
let hash: Promise<string> | undefined;
const testPasswordHash = (): Promise<string> =>
  (hash ??= new Argon2PasswordHasher().hash(TEST_PASSWORD));

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly role: UserRole;
  readonly organizationId: string | null;
}

/** Inserts a User (the sign-in flow is what the tests exercise, not creation). */
export async function createUser(
  prisma: PrismaClient,
  options: {
    role?: UserRole;
    /** Ignored for a Super Admin. Default: the default Organization. */
    organizationId?: string;
    active?: boolean;
  } = {},
): Promise<TestUser> {
  const role = options.role ?? 'OPERATOR';
  const organizationId =
    role === 'SUPER_ADMIN'
      ? null
      : (options.organizationId ?? DEFAULT_ORGANIZATION_ID);
  const id = randomUUID();
  const email = `${role.toLowerCase()}-${id}@paybridge.test`;
  await prisma.user.create({
    data: {
      id,
      email,
      name: `Test ${role}`,
      passwordHash: await testPasswordHash(),
      role,
      organizationId,
      active: options.active ?? true,
    },
  });
  return { id, email, password: TEST_PASSWORD, role, organizationId };
}

export function signIn(
  app: INestApplication,
  credentials: { email: string; password: string },
): request.Test {
  return request(app.getHttpServer())
    .post('/internal/auth/sign-in')
    .send(credentials);
}

export function refresh(
  app: INestApplication,
  refreshToken: string,
): request.Test {
  return request(app.getHttpServer())
    .post('/internal/auth/refresh')
    .send({ refreshToken });
}

export interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export async function signInOk(
  app: INestApplication,
  user: Pick<TestUser, 'email' | 'password'>,
): Promise<SignedIn> {
  const res = await signIn(app, user).expect(200);
  return res.body as SignedIn;
}

/** HTTP calls to the in-process app, signed in as one User. */
export interface SignedInHttp {
  readonly user: TestUser;
  readonly accessToken: string;
  get(path: string): request.Test;
  post(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
}

export async function signedInHttp(
  app: INestApplication,
  prisma: PrismaClient,
  options: Parameters<typeof createUser>[1] = {},
): Promise<SignedInHttp> {
  const user = await createUser(prisma, options);
  const { accessToken } = await signInOk(app, user);
  const auth = `Bearer ${accessToken}`;
  const server = app.getHttpServer();
  return {
    user,
    accessToken,
    get: (path) => request(server).get(path).set('Authorization', auth),
    post: (path) => request(server).post(path).set('Authorization', auth),
    put: (path) => request(server).put(path).set('Authorization', auth),
    delete: (path) => request(server).delete(path).set('Authorization', auth),
  };
}
