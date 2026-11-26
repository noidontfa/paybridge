import type {
  IdempotencyRecord,
  NewIdempotencyRecord,
} from '../../domain/records.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../domain/value-objects/organization-scope.js';
import type { IdempotencyKeyRepository } from '../../domain/repositories/repositories.js';
import type { DbContext } from './db.js';
import { scopeWhere } from './scope.js';
import { rethrowUniqueViolation } from './unique-violation.js';

/** Idempotency-Key records for `POST /payments` (kept 24 hours). */
export class PrismaIdempotencyKeyRepository implements IdempotencyKeyRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(
    scope: OrganizationScope,
    record: NewIdempotencyRecord,
  ): Promise<IdempotencyRecord> {
    return rethrowUniqueViolation(
      this.ctx.db.idempotencyKey.create({
        data: {
          organizationId: scope.organizationId,
          key: record.key,
          requestHash: record.requestHash,
          responseStatus: record.responseStatus,
          responseBody: record.responseBody as object,
          paymentId: record.paymentId,
          expiresAt: record.expiresAt,
          ...(record.createdAt && { createdAt: record.createdAt }),
        },
      }),
    );
  }

  async find(
    scope: OrganizationScope,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    return this.ctx.db.idempotencyKey.findUnique({
      where: {
        organizationId_key: { organizationId: scope.organizationId, key },
      },
    });
  }

  /** Deletes the record for `key` if it expired at or before `now`. */
  async deleteIfExpired(
    scope: OrganizationScope,
    key: string,
    now: Date,
  ): Promise<void> {
    await this.ctx.db.idempotencyKey.deleteMany({
      where: { ...scopeWhere(scope), key, expiresAt: { lte: now } },
    });
  }

  /** Retention: deletes every record that expired at or before `cutoff`. */
  async deleteExpiredBefore(scope: ReadScope, cutoff: Date): Promise<number> {
    const { count } = await this.ctx.db.idempotencyKey.deleteMany({
      where: { ...scopeWhere(scope), expiresAt: { lte: cutoff } },
    });
    return count;
  }
}
