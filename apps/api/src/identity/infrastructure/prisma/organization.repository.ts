import type { Organization as OrganizationRow } from '../../../generated/prisma/client.js';
import type {
  NewOrganization,
  Organization,
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

  async create(organization: NewOrganization): Promise<Organization> {
    const row = await this.ctx.db.organization.create({
      data: { id: organization.id, name: organization.name },
    });
    return toOrganization(row);
  }
}
