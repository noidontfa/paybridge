import { Inject, Injectable } from '@nestjs/common';
import {
  LastSuperAdminError,
  UserNotFoundError,
} from '../../domain/errors.js';
import type { User } from '../../domain/entities/user.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';

/**
 * The platform's own people: list, deactivate, reactivate. The platform keeps
 * at least one active Super Admin; concurrent changes are serialized so two
 * Super Admins cannot deactivate each other. A Super Admin's Role never
 * changes. Deactivating revokes their refresh tokens.
 */
@Injectable()
export class ManageSuperAdmins {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  list(): Promise<User[]> {
    return this.runner.repositories.users.listSuperAdmins();
  }

  deactivate(userId: string): Promise<void> {
    const now = this.clock.now();
    return this.runner.run(async (repos) => {
      await repos.users.lockSuperAdmins();
      const user = await repos.users.findById(userId);
      if (user?.role !== 'SUPER_ADMIN') throw new UserNotFoundError();
      if (
        user.active &&
        (await repos.users.countActiveSuperAdmins(userId)) === 0
      ) {
        throw new LastSuperAdminError();
      }
      await repos.users.update(userId, { active: false });
      await repos.refreshTokens.revokeAllOfUser(userId, now);
    });
  }

  reactivate(userId: string): Promise<void> {
    return this.runner.run(async (repos) => {
      const user = await repos.users.findById(userId);
      if (user?.role !== 'SUPER_ADMIN') throw new UserNotFoundError();
      await repos.users.update(userId, { active: true });
    });
  }
}
