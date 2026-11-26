import type { DbContext } from './db.js';
import { PrismaInvitationRepository } from './invitation.repository.js';
import { PrismaOrganizationRepository } from './organization.repository.js';
import { PrismaPasswordResetRepository } from './password-reset.repository.js';
import { PrismaRefreshTokenRepository } from './refresh-token.repository.js';
import { PrismaUserRepository } from './user.repository.js';

/** Every identity repository, bound to one database handle. */
export interface Repositories {
  readonly organizations: PrismaOrganizationRepository;
  readonly users: PrismaUserRepository;
  readonly refreshTokens: PrismaRefreshTokenRepository;
  readonly passwordResets: PrismaPasswordResetRepository;
  readonly invitations: PrismaInvitationRepository;
}

export function createRepositories(ctx: DbContext): Repositories {
  return {
    organizations: new PrismaOrganizationRepository(ctx),
    users: new PrismaUserRepository(ctx),
    refreshTokens: new PrismaRefreshTokenRepository(ctx),
    passwordResets: new PrismaPasswordResetRepository(ctx),
    invitations: new PrismaInvitationRepository(ctx),
  };
}
