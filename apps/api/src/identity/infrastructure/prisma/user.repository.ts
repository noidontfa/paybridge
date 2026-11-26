import { Prisma } from '../../../generated/prisma/client.js';
import type { User as UserRow } from '../../../generated/prisma/client.js';
import { EmailTakenError } from '../../domain/errors.js';
import type { NewUser, User, UserRole } from '../../domain/user.js';
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

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.ctx.db.user.update({ where: { id }, data: { passwordHash } });
  }

  async resetPassword(id: string, passwordHash: string): Promise<void> {
    await this.ctx.db.user.update({
      where: { id },
      data: { passwordHash, active: true },
    });
  }

  async listByOrganization(organizationId: string): Promise<User[]> {
    const rows = await this.ctx.db.user.findMany({
      where: { organizationId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toUser);
  }

  async update(
    id: string,
    changes: { role?: UserRole; active?: boolean },
  ): Promise<void> {
    await this.ctx.db.user.update({ where: { id }, data: changes });
  }

  async countActiveAdmins(
    organizationId: string,
    exceptUserId: string,
  ): Promise<number> {
    return this.ctx.db.user.count({
      where: {
        organizationId,
        role: 'ORGANIZATION_ADMIN',
        active: true,
        id: { not: exceptUserId },
      },
    });
  }
}
