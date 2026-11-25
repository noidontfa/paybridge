import { Prisma } from '../../../generated/prisma/client.js';
import type { User as UserRow } from '../../../generated/prisma/client.js';
import { EmailTakenError } from '../../domain/errors.js';
import type { NewUser, User } from '../../domain/user.js';
import { UserRepository } from '../../port/user.repository.js';
import type { DbContext } from './db.js';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    role: row.role,
    organizationId: row.organizationId,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Users in `iam_users`. There is no delete: a User is deactivated. */
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.ctx.db.user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.ctx.db.user.findUnique({ where: { email } });
    return row ? toUser(row) : null;
  }

  async create(user: NewUser): Promise<User> {
    try {
      return toUser(await this.ctx.db.user.create({ data: user }));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new EmailTakenError(user.email);
      }
      throw error;
    }
  }

  async resetPassword(id: string, passwordHash: string): Promise<void> {
    await this.ctx.db.user.update({
      where: { id },
      data: { passwordHash, active: true },
    });
  }
}
