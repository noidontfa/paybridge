import { Inject, Injectable } from '@nestjs/common';
import { InvalidResetTokenError } from '../../domain/errors.js';
import { assertStrongPassword } from '../../domain/entities/user.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';
import { PasswordHasher } from '../../domain/services/password-hasher.js';
import { hashResetToken } from './request-password-reset.js';

/**
 * Sets a new password from a Password Reset link, once, and signs the User
 * out everywhere (all refresh tokens are revoked). A too-short password is
 * refused before the link is spent.
 */
@Injectable()
export class CompletePasswordReset {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(token: string, newPassword: string): Promise<void> {
    assertStrongPassword(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);
    const now = this.clock.now();
    await this.runner.run(async (repos) => {
      const reset = await repos.passwordResets.findByHash(
        hashResetToken(token),
      );
      if (!reset || reset.usedAt !== null || now >= reset.expiresAt) {
        throw new InvalidResetTokenError();
      }
      const user = await repos.users.findById(reset.userId);
      if (!user?.active) throw new InvalidResetTokenError();
      if (!(await repos.passwordResets.markUsed(reset.id, now))) {
        throw new InvalidResetTokenError();
      }
      await repos.users.setPasswordHash(user.id, passwordHash);
      await repos.refreshTokens.revokeAllOfUser(user.id, now);
    });
  }
}
