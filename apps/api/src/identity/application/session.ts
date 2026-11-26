import { createHash, randomBytes } from 'node:crypto';
import { newIdentityId } from '../domain/ids.js';
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_IDLE_MS,
} from '../domain/refresh-token.js';
import { permissionsOf, type Permission } from '../domain/permissions.js';
import type { User, UserRole } from '../domain/user.js';
import { AccessTokenService } from '../port/access-token.service.js';
import type { Repositories } from '../infrastructure/prisma/repositories.js';

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly organization: { readonly id: string; readonly name: string } | null;
  readonly permissions: readonly Permission[];
}

/** What sign-in and refresh hand back. Only the BFF ever sees the tokens. */
export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
  readonly user: SessionUser;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toSessionUser(
  user: User,
  organizationName: string | null,
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organization:
      user.organizationId && organizationName !== null
        ? { id: user.organizationId, name: organizationName }
        : null,
    permissions: permissionsOf(user.role),
  };
}

/**
 * Issues an access token and a new refresh token for `user`, in `family`.
 * `familyExpiresAt` is the absolute end of the family (7 days after sign-in).
 */
export async function issueSession(
  repos: Repositories,
  tokens: AccessTokenService,
  user: User,
  now: Date,
  family: { familyId: string; expiresAt: Date },
): Promise<Session> {
  const organization = user.organizationId
    ? await repos.organizations.findById(user.organizationId)
    : null;
  const refreshToken = randomBytes(32).toString('base64url');
  await repos.refreshTokens.create({
    id: newIdentityId(),
    familyId: family.familyId,
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: family.expiresAt,
    idleExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_IDLE_MS),
  });
  const sessionUser = toSessionUser(user, organization?.name ?? null);
  return {
    accessToken: tokens.sign(
      {
        userId: user.id,
        role: user.role,
        organizationId: user.organizationId,
        permissions: sessionUser.permissions,
      },
      now,
    ),
    refreshToken,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    user: sessionUser,
  };
}
