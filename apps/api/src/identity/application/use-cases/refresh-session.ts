import { Inject, Injectable } from '@nestjs/common';
import { InvalidRefreshTokenError } from '../../domain/errors.js';
import { isRefreshTokenLive } from '../../domain/refresh-token.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AccessTokenService } from '../../port/access-token.service.js';
import { IdentityClock } from '../../port/clock.js';
import { hashRefreshToken, issueSession, type Session } from '../session.js';

/**
 * Trades a refresh token for a new access token and a new refresh token (the
 * old one is spent). Presenting a spent token again is treated as theft and
 * revokes its whole family. A deactivated User or a suspended Organization
 * cannot refresh; the family is revoked.
 */
@Injectable()
export class RefreshSession {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(refreshToken: string): Promise<Session> {
    const now = this.clock.now();
    // The revocation must commit even though the caller gets an error, so the
    // transaction returns the outcome instead of throwing.
    const outcome = await this.runner.run(
      async (repos): Promise<Session | 'invalid'> => {
        const stored = await repos.refreshTokens.findByHash(
          hashRefreshToken(refreshToken),
        );
        if (!stored) return 'invalid';
        if (stored.usedAt !== null && stored.revokedAt === null) {
          await repos.refreshTokens.revokeFamily(stored.familyId, now);
          return 'invalid';
        }
        if (!isRefreshTokenLive(stored, now)) return 'invalid';
        if (!(await repos.refreshTokens.markUsed(stored.id, now))) {
          await repos.refreshTokens.revokeFamily(stored.familyId, now);
          return 'invalid';
        }

        const user = await repos.users.findById(stored.userId);
        const organization = user?.organizationId
          ? await repos.organizations.findById(user.organizationId)
          : null;
        if (
          !user?.active ||
          (user.organizationId && organization?.status !== 'ACTIVE')
        ) {
          await repos.refreshTokens.revokeFamily(stored.familyId, now);
          return 'invalid';
        }
        return issueSession(repos, this.tokens, user, now, {
          familyId: stored.familyId,
          expiresAt: stored.expiresAt,
        });
      },
    );
    if (outcome === 'invalid') throw new InvalidRefreshTokenError();
    return outcome;
  }
}
