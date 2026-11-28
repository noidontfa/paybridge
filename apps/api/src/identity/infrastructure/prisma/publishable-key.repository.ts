import { roleOf } from '../../../common/principal/actor.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../../common/organization-scope.js';
import type { PublishableKey as PublishableKeyRow } from '../../../generated/prisma/client.js';
import type {
  Actor,
  NewPublishableKey,
  PublishableKey,
} from '../../domain/entities/publishable-key.js';
import { PublishableKeyRepository } from '../../domain/repositories/publishable-key.repository.js';
import type { DbContext } from './db.js';

const writer = (
  userId: string | null,
  role: string | null,
  name: string | null,
): Actor | null =>
  userId && role ? { userId, role: roleOf(role), name: name ?? '' } : null;

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
    createdBy: writer(
      row.createdByUserId,
      row.createdByRole,
      row.createdByName,
    ),
    updatedBy: writer(
      row.updatedByUserId,
      row.updatedByRole,
      row.updatedByName,
    ),
  };
}

const updatedBy = (by: Actor, at: Date) => ({
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

  async create(
    scope: OrganizationScope,
    key: NewPublishableKey,
  ): Promise<PublishableKey> {
    const row = await this.ctx.db.publishableKey.create({
      data: {
        id: key.id,
        organizationId: scope.organizationId,
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

  async findByKey(
    scope: ReadScope,
    key: string,
  ): Promise<PublishableKey | null> {
    const row = await this.ctx.db.publishableKey.findFirst({
      where: {
        key,
        ...(scope.kind === 'organization'
          ? { organizationId: scope.organizationId }
          : {}),
      },
    });
    return row ? toEntity(row) : null;
  }

  async findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<PublishableKey | null> {
    const row = await this.ctx.db.publishableKey.findFirst({
      where: { id, organizationId: scope.organizationId },
    });
    return row ? toEntity(row) : null;
  }

  async list(scope: OrganizationScope): Promise<PublishableKey[]> {
    const rows = await this.ctx.db.publishableKey.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEntity);
  }

  async setAllowedOrigins(
    scope: OrganizationScope,
    id: string,
    allowedOrigins: readonly string[],
    by: Actor,
    at: Date,
  ): Promise<PublishableKey> {
    const where = { id, organizationId: scope.organizationId };
    await this.ctx.db.publishableKey.updateMany({
      where,
      data: { allowedOrigins: [...allowedOrigins], ...updatedBy(by, at) },
    });
    const row = await this.ctx.db.publishableKey.findFirstOrThrow({ where });
    return toEntity(row);
  }

  async revoke(
    scope: OrganizationScope,
    id: string,
    by: Actor,
    at: Date,
  ): Promise<void> {
    await this.ctx.db.publishableKey.updateMany({
      where: { id, organizationId: scope.organizationId, revokedAt: null },
      data: { revokedAt: at, ...updatedBy(by, at) },
    });
  }
}
