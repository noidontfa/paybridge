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
   * Claims a `RECEIVED` or `FAILED` row for processing: sets `PROCESSING`,
   * the lock time, and counts one more processing try in `attempts`. Returns
   * null when the row is missing, already `PROCESSED`, or being processed
   * (`PROCESSING`), so a duplicate job does nothing.
   */
  async claim(id: string, now: Date): Promise<WebhookInboxEntry | null> {
    const { count } = await this.ctx.db.webhookInbox.updateMany({
      where: { id, status: { in: ['RECEIVED', 'FAILED'] } },
      data: { status: 'PROCESSING', lockedAt: now, attempts: { increment: 1 } },
    });
    return count === 0 ? null : this.findById(id);
  }

  /** Marks a row done. Use the transaction that applied its change. */
  async markProcessed(id: string, now: Date): Promise<void> {
    await this.ctx.db.webhookInbox.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        processedAt: now,
        lockedAt: null,
        lastError: null,
      },
    });
  }

  /** Marks a row failed with the error, for the inbox sweep to retry. */
  async markFailed(id: string, error: string): Promise<void> {
    await this.ctx.db.webhookInbox.update({
      where: { id },
      data: { status: 'FAILED', lockedAt: null, lastError: error },
    });
  }

  /**
   * Inbox sweep: resets `PROCESSING` rows locked before `cutoff` (the worker
   * died) to `RECEIVED` and clears the lock. A row locked at or after the
   * cutoff is not touched. Returns the number of rows reset.
   */
  async resetStaleProcessing(cutoff: Date): Promise<number> {
    const { count } = await this.ctx.db.webhookInbox.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: cutoff } },
      data: { status: 'RECEIVED', lockedAt: null },
    });
    return count;
  }

  /**
   * Inbox sweep: ids of rows to dispatch, oldest first, at most `limit`: every
   * `RECEIVED` row, and `FAILED` rows tried at most `maxAttempts` times.
   */
  async findDispatchableIds(
    maxAttempts: number,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.ctx.db.webhookInbox.findMany({
      where: {
        OR: [
          { status: 'RECEIVED' },
          { status: 'FAILED', attempts: { lte: maxAttempts } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      select: { id: true },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  /** `FAILED` rows tried more than `maxAttempts` times: left for manual handling. */
  async findExhausted(
    maxAttempts: number,
    limit: number,
  ): Promise<WebhookInboxEntry[]> {
    const rows = await this.ctx.db.webhookInbox.findMany({
      where: { status: 'FAILED', attempts: { gt: maxAttempts } },
      orderBy: { receivedAt: 'asc' },
      take: limit,
    });
    return rows.map(toEntry);
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
