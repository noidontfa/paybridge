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
      },
    });
  }

  async find(key: string): Promise<IdempotencyRecord | null> {
    return this.ctx.db.idempotencyKey.findUnique({ where: { key } });
  }
}
