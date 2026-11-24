import type {
  IdempotencyRecord,
  NewIdempotencyRecord,
} from '../../domain/records.js';
import type { DbContext } from './db.js';

/** Idempotency-Key records for `POST /payments` (kept 24 hours). */
export class PrismaIdempotencyKeyRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(record: NewIdempotencyRecord): Promise<IdempotencyRecord> {
    return this.ctx.db.idempotencyKey.create({
      data: {
        key: record.key,
        requestHash: record.requestHash,
        responseStatus: record.responseStatus,
        responseBody: record.responseBody as object,
        paymentId: record.paymentId,
        expiresAt: record.expiresAt,
        ...(record.createdAt && { createdAt: record.createdAt }),
      },
    });
  }

  async find(key: string): Promise<IdempotencyRecord | null> {
    return this.ctx.db.idempotencyKey.findUnique({ where: { key } });
  }

  /** Deletes the record for `key` if it expired at or before `now`. */
  async deleteIfExpired(key: string, now: Date): Promise<void> {
    await this.ctx.db.idempotencyKey.deleteMany({
      where: { key, expiresAt: { lte: now } },
    });
  }
}
