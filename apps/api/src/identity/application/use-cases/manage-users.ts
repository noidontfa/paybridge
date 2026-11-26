import { Inject, Injectable } from '@nestjs/common';
import {
  LastOrganizationAdminError,
  UserNotFoundError,
} from '../../domain/errors.js';
import type { ManagedRole, User, UserRole } from '../../domain/entities/user.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';


/**
 * An Organization's people: list, change Role, deactivate, reactivate. Every
 * call is scoped to one Organization taken from the principal. An Organization
 * keeps at least one active Organization Admin. A Role change or a
 * deactivation revokes the User's refresh tokens, so their sensitive writes
 * stop at once and their reads at the end of the access token (ADR 0008).
 * Super Admins belong to no Organization and are never found here.
 */
@Injectable()
export class ManageUsers {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  list(organizationId: string): Promise<User[]> {
    return this.runner.repositories.users.listByOrganization(organizationId);
  }

  changeRole(
    organizationId: string,
    userId: string,
    role: ManagedRole,
  ): Promise<void> {
    return this.change(organizationId, userId, (user) => ({
      changes: { role },
      removesActiveAdmin: user.role === 'ORGANIZATION_ADMIN' && role !== user.role,
      revoke: role !== user.role,
    }));
  }

  deactivate(organizationId: string, userId: string): Promise<void> {
    return this.change(organizationId, userId, (user) => ({
      changes: { active: false },
      removesActiveAdmin: user.role === 'ORGANIZATION_ADMIN' && user.active,
      revoke: true,
    }));
  }

  reactivate(organizationId: string, userId: string): Promise<void> {
    return this.change(organizationId, userId, () => ({
      changes: { active: true },
      removesActiveAdmin: false,
      revoke: false,
    }));
  }

  private change(
    organizationId: string,
    userId: string,
    decide: (user: User) => {
      changes: { role?: UserRole; active?: boolean };
      removesActiveAdmin: boolean;
      revoke: boolean;
    },
  ): Promise<void> {
    const now = this.clock.now();
    return this.runner.run(async (repos) => {
      // Serialize concurrent changes in one Organization, so two admins
      // cannot each remove the other.
      await repos.organizations.lockForUpdate(organizationId);
      const user = await repos.users.findById(userId);
      if (user?.organizationId !== organizationId)
        throw new UserNotFoundError();
      const { changes, removesActiveAdmin, revoke } = decide(user);
      if (
        removesActiveAdmin &&
        (await repos.users.countActiveAdmins(organizationId, userId)) === 0
      ) {
        throw new LastOrganizationAdminError();
      }
      await repos.users.update(userId, changes);
      if (revoke) await repos.refreshTokens.revokeAllOfUser(userId, now);
    });
  }
}
