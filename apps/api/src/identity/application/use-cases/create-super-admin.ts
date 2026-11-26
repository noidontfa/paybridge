import { EmailTakenError } from '../../domain/errors.js';
import { newIdentityId } from '../../domain/ids.js';
import {
  assertStrongPassword,
  normalizeEmail,
  type User,
} from '../../domain/entities/user.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';
import { PasswordHasher } from '../../domain/services/password-hasher.js';

export interface CreateSuperAdminInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

export interface CreateSuperAdminResult {
  readonly user: User;
  /** True when an existing Super Admin was recovered instead of created. */
  readonly recovered: boolean;
}

/**
 * Creates a Super Admin. It works at any time, also when Super Admins already
 * exist. When the email already belongs to a Super Admin, that account is
 * recovered instead: new password, active again, every refresh token revoked.
 * An email that belongs to any other Role is refused.
 *
 * Plain class (no Nest decorators): the CLI builds it by hand.
 */
export class CreateSuperAdmin {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly hasher: PasswordHasher,
    private readonly clock: IdentityClock,
  ) {}

  async execute(input: CreateSuperAdminInput): Promise<CreateSuperAdminResult> {
    assertStrongPassword(input.password);
    const email = normalizeEmail(input.email);
    const passwordHash = await this.hasher.hash(input.password);

    return this.runner.run(async (repos) => {
      const existing = await repos.users.findByEmail(email);
      if (!existing) {
        const user = await repos.users.create({
          id: newIdentityId(),
          email,
          name: input.name.trim() || email,
          passwordHash,
          role: 'SUPER_ADMIN',
          organizationId: null,
        });
        return { user, recovered: false };
      }
      if (existing.role !== 'SUPER_ADMIN') throw new EmailTakenError(email);
      await repos.users.resetPassword(existing.id, passwordHash);
      await repos.refreshTokens.revokeAllOfUser(existing.id, this.clock.now());
      return { user: { ...existing, passwordHash, active: true }, recovered: true };
    });
  }
}
