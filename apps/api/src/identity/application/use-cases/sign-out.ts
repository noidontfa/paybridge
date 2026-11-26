import { Inject, Injectable } from '@nestjs/common';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';
import { hashRefreshToken } from '../session.js';

/** Revokes the sign-in (token family) a refresh token belongs to. Idempotent. */
@Injectable()
export class SignOut {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(refreshToken: string): Promise<void> {
    await this.runner.run(async (repos) => {
      const stored = await repos.refreshTokens.findByHash(
        hashRefreshToken(refreshToken),
      );
      if (stored) {
        await repos.refreshTokens.revokeFamily(stored.familyId, this.clock.now());
      }
    });
  }
}
