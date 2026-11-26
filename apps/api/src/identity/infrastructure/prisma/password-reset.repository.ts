import type {
  NewPasswordReset,
  PasswordReset,
} from '../../domain/password-reset.js';
import { PasswordResetRepository } from '../../port/password-reset.repository.js';
import type { DbContext } from './db.js';

/** Password Resets in `iam_password_resets`, by hash only. */
export class PrismaPasswordResetRepository extends PasswordResetRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(reset: NewPasswordReset): Promise<void> {
    await this.ctx.db.passwordReset.create({ data: reset });
  }

  async findByHash(tokenHash: string): Promise<PasswordReset | null> {
    return this.ctx.db.passwordReset.findUnique({ where: { tokenHash } });
  }

  async markUsed(id: string, at: Date): Promise<boolean> {
    const { count } = await this.ctx.db.passwordReset.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }

  async voidUnusedOfUser(userId: string, at: Date): Promise<void> {
    await this.ctx.db.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: at },
    });
  }
}
