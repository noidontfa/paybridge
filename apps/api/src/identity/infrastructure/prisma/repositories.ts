import type { Repositories } from '../../domain/repositories/repositories.js';
import { PrismaApiKeyRepository } from './api-key.repository.js';
import type { DbContext } from './db.js';
import { PrismaInvitationRepository } from './invitation.repository.js';
import { PrismaOrganizationRepository } from './organization.repository.js';
import { PrismaPasswordResetRepository } from './password-reset.repository.js';
import { PrismaRefreshTokenRepository } from './refresh-token.repository.js';
import { PrismaUserRepository } from './user.repository.js';

/** Every Prisma repository, bound to one database handle. Add new ones here. */
export function createRepositories(ctx: DbContext): Repositories {
  return {
    organizations: new PrismaOrganizationRepository(ctx),
    users: new PrismaUserRepository(ctx),
    refreshTokens: new PrismaRefreshTokenRepository(ctx),
    passwordResets: new PrismaPasswordResetRepository(ctx),
    invitations: new PrismaInvitationRepository(ctx),
    apiKeys: new PrismaApiKeyRepository(ctx),
  };
}
