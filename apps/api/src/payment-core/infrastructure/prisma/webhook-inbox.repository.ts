import type { WebhookInbox as WebhookInboxRow } from '../../../generated/prisma/client.js';
import { newId } from '../../domain/ids.js';
import type {
  NewWebhookInboxEntry,
  WebhookInboxEntry,
} from '../../domain/records.js';
import type { DbContext } from './db.js';

export interface RecordedWebhook {
  readonly entry: WebhookInboxEntry;
  /** True when a row with the same gateway and dedupe key already existed. */
  readonly duplicate: boolean;
}

function toEntry(row: WebhookInboxRow): WebhookInboxEntry {
  return {
    ...row,
    rawBody: new Uint8Array(row.rawBody),
    headers: row.headers as Record<string, unknown>,
    query: row.query as Record<string, unknown>,
  };
}

/** Verified gateway callbacks, stored before processing. */
export class PrismaWebhookInboxRepository {
  constructor(private readonly ctx: DbContext) {}

  /**
   * Stores the callback as `RECEIVED` unless one with the same gateway and
   * dedupe key exists (`ON CONFLICT DO NOTHING`, so it never aborts the
   * surrounding transaction). Returns the stored row either way.
   */
  async record(callback: NewWebhookInboxEntry): Promise<RecordedWebhook> {
    const { count } = await this.ctx.db.webhookInbox.createMany({
      data: {
        id: callback.id ?? newId(),
        gatewayId: callback.gatewayId,
        dedupeKey: callback.dedupeKey,
        providerEventId: callback.providerEventId ?? null,
        attemptKey: callback.attemptKey ?? null,
        rawBody: new Uint8Array(callback.rawBody),
        headers: callback.headers as object,
        query: callback.query as object,
      },
      skipDuplicates: true,
    });
    const row = await this.ctx.db.webhookInbox.findUniqueOrThrow({
      where: {
        gatewayId_dedupeKey: {
          gatewayId: callback.gatewayId,
          dedupeKey: callback.dedupeKey,
        },
      },
    });
    return { entry: toEntry(row), duplicate: count === 0 };
  }

  async findById(id: string): Promise<WebhookInboxEntry | null> {
    const row = await this.ctx.db.webhookInbox.findUnique({ where: { id } });
    return row ? toEntry(row) : null;
  }

  /**
   * Retention: deletes rows received at or before `cutoff`, except `FAILED`
   * rows, which are never deleted automatically.
   */
  async deleteReceivedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.ctx.db.webhookInbox.deleteMany({
      where: { receivedAt: { lte: cutoff }, status: { not: 'FAILED' } },
    });
    return count;
  }
}
