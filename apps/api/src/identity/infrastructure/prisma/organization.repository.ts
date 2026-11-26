import type { Organization as OrganizationRow } from '../../../generated/prisma/client.js';
import type {
  NewOrganization,
  Organization,
  OrganizationStatus,
} from '../../domain/organization.js';
import { OrganizationRepository } from '../../port/organization.repository.js';
import type { DbContext } from './db.js';

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Organizations in `iam_organizations`. There is no delete. */
export class PrismaOrganizationRepository extends OrganizationRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async findById(id: string): Promise<Organization | null> {
    const row = await this.ctx.db.organization.findUnique({ where: { id } });
    return row ? toOrganization(row) : null;
  }

  async list(): Promise<Organization[]> {
    const rows = await this.ctx.db.organization.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toOrganization);
  }

  async create(organization: NewOrganization): Promise<Organization> {
    const row = await this.ctx.db.organization.create({
      data: { id: organization.id, name: organization.name },
    });
    return toOrganization(row);
  }

  async setStatus(id: string, status: OrganizationStatus): Promise<void> {
    await this.ctx.db.organization.update({ where: { id }, data: { status } });
  }

  async lockForUpdate(id: string): Promise<void> {
    await this.ctx.db
      .$queryRaw`SELECT id FROM iam_organizations WHERE id = ${id}::uuid FOR UPDATE`;
  }
}
