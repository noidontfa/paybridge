import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidCurrentPasswordError,
  UserDeactivatedError,
} from '../../domain/errors.js';
import { assertStrongPassword } from '../../domain/user.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { IdentityClock } from '../../port/clock.js';
import { PasswordHasher } from '../../port/password-hasher.js';
import { hashRefreshToken } from '../session.js';

export interface ChangePasswordInput {
  readonly userId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  /** The caller's own refresh token: its sign-in stays; every other ends. */
  readonly keepRefreshToken?: string | undefined;
}

/**
 * A signed-in User changes their own password by giving the current one. A
 * sensitive write: the User is re-read from the database, so a deactivation
 * since sign-in is honoured at once.
 */
@Injectable()
export class ChangePassword {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(input: ChangePasswordInput): Promise<void> {
    const user = await this.runner.repositories.users.findById(input.userId);
    if (!user?.active) throw new UserDeactivatedError();
    if (!(await this.hasher.verify(input.currentPassword, user.passwordHash))) {
      throw new InvalidCurrentPasswordError();
    }
    assertStrongPassword(input.newPassword);
    const passwordHash = await this.hasher.hash(input.newPassword);
    const now = this.clock.now();
    await this.runner.run(async (repos) => {
      await repos.users.setPasswordHash(user.id, passwordHash);
      const kept = input.keepRefreshToken
        ? await repos.refreshTokens.findByHash(
            hashRefreshToken(input.keepRefreshToken),
          )
        : null;
      if (kept && kept.userId === user.id && kept.revokedAt === null) {
        await repos.refreshTokens.revokeAllOfUserExceptFamily(
          user.id,
          kept.familyId,
          now,
        );
      } else {
        await repos.refreshTokens.revokeAllOfUser(user.id, now);
      }
    });
  }
}
