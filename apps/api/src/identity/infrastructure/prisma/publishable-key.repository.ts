import type { PublishableKey as PublishableKeyRow } from '../../../generated/prisma/client.js';
import type {
  KeyWriter,
  NewPublishableKey,
  PublishableKey,
} from '../../domain/entities/publishable-key.js';
import { PublishableKeyRepository } from '../../domain/repositories/publishable-key.repository.js';
import type { DbContext } from './db.js';

const writer = (
  userId: string | null,
  role: string | null,
  name: string | null,
): KeyWriter | null => (userId && role ? { userId, role, name } : null);

function toEntity(row: PublishableKeyRow): PublishableKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    key: row.key,
    allowedOrigins: row.allowedOrigins,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
    createdBy: writer(row.createdByUserId, row.createdByRole, row.createdByName),
    updatedBy: writer(row.updatedByUserId, row.updatedByRole, row.updatedByName),
  };
}

const updatedBy = (by: KeyWriter, at: Date) => ({
  updatedAt: at,
  updatedByUserId: by.userId,
  updatedByRole: by.role,
  updatedByName: by.name,
});

/** Publishable Keys in `iam_publishable_keys`, stored in clear (not secret). */
export class PrismaPublishableKeyRepository extends PublishableKeyRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(key: NewPublishableKey): Promise<PublishableKey> {
    const row = await this.ctx.db.publishableKey.create({
      data: {
        id: key.id,
        organizationId: key.organizationId,
        label: key.label,
        key: key.key,
        allowedOrigins: [...key.allowedOrigins],
        createdAt: key.createdAt,
        updatedAt: key.createdAt,
        createdByUserId: key.createdBy?.userId ?? null,
        createdByRole: key.createdBy?.role ?? null,
        createdByName: key.createdBy?.name ?? null,
        updatedByUserId: key.createdBy?.userId ?? null,
        updatedByRole: key.createdBy?.role ?? null,
        updatedByName: key.createdBy?.name ?? null,
      },
    });
    return toEntity(row);
  }

  async findByKey(key: string): Promise<PublishableKey | null> {
    const row = await this.ctx.db.publishableKey.findUnique({ where: { key } });
    return row ? toEntity(row) : null;
  }

  async findOfOrganization(
    organizationId: string,
    id: string,
  ): Promise<PublishableKey | null> {
    const row = await this.ctx.db.publishableKey.findFirst({
      where: { id, organizationId },
    });
    return row ? toEntity(row) : null;
  }

  async listOfOrganization(organizationId: string): Promise<PublishableKey[]> {
    const rows = await this.ctx.db.publishableKey.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEntity);
  }

  async setAllowedOrigins(
    organizationId: string,
    id: string,
    allowedOrigins: readonly string[],
    by: KeyWriter,
    at: Date,
  ): Promise<PublishableKey> {
    await this.ctx.db.publishableKey.updateMany({
      where: { id, organizationId },
      data: { allowedOrigins: [...allowedOrigins], ...updatedBy(by, at) },
    });
    const row = await this.ctx.db.publishableKey.findFirstOrThrow({
      where: { id, organizationId },
    });
    return toEntity(row);
  }

  async revoke(
    organizationId: string,
    id: string,
    by: KeyWriter,
    at: Date,
  ): Promise<void> {
    await this.ctx.db.publishableKey.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: at, ...updatedBy(by, at) },
    });
  }
}
