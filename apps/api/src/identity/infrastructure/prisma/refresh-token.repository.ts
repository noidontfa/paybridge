import type {
  NewRefreshToken,
  RefreshToken,
} from '../../domain/refresh-token.js';
import { RefreshTokenRepository } from '../../port/refresh-token.repository.js';
import type { DbContext } from './db.js';

/** Refresh tokens in `iam_refresh_tokens`, by hash only. */
export class PrismaRefreshTokenRepository extends RefreshTokenRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(token: NewRefreshToken): Promise<void> {
    await this.ctx.db.refreshToken.create({ data: token });
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.ctx.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  async markUsed(id: string, at: Date): Promise<boolean> {
    const { count } = await this.ctx.db.refreshToken.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.ctx.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllOfUserExceptFamily(
    userId: string,
    keepFamilyId: string,
    at: Date,
  ): Promise<void> {
    await this.ctx.db.refreshToken.updateMany({
      where: { userId, familyId: { not: keepFamilyId }, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllOfOrganization(
    organizationId: string,
    at: Date,
  ): Promise<void> {
    await this.ctx.db.refreshToken.updateMany({
      where: { user: { organizationId }, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllOfUser(userId: string, at: Date): Promise<void> {
    await this.ctx.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
