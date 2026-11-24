import { newId } from '../../domain/ids.js';
import type { NewOutboxEvent, OutboxEvent } from '../../domain/records.js';
import type { DbContext } from './db.js';

/**
 * Transactional outbox of Payment-level events. Write it with the runner's
 * transaction-bound repositories so the event exists if and only if the state
 * change committed. The row id is also the BullMQ job id.
 */
export class PrismaOutboxRepository {
  constructor(private readonly ctx: DbContext) {}

  async add(event: NewOutboxEvent): Promise<OutboxEvent> {
    return this.ctx.db.outboxEvent.create({
      data: {
        id: event.id ?? newId(),
        eventType: event.eventType,
        paymentId: event.paymentId,
        payload: (event.payload ?? {}) as object,
      },
    });
  }

  /** Every event of one Payment, oldest first. */
  async listForPayment(paymentId: string): Promise<OutboxEvent[]> {
    return this.ctx.db.outboxEvent.findMany({
      where: { paymentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * The oldest unpublished rows, at most `limit`. Ordered by id (UUID v7, so
   * creation order); served by the partial index on unpublished ids.
   */
  async findUnpublished(limit: number): Promise<OutboxEvent[]> {
    return this.ctx.db.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /**
   * Sets the published time once. A row another relay instance already
   * marked keeps its time. Never deletes (retention does that).
   */
  async markPublished(id: string, publishedAt: Date): Promise<void> {
    await this.ctx.db.outboxEvent.updateMany({
      where: { id, publishedAt: null },
      data: { publishedAt },
    });
  }

  /**
   * Retention: deletes rows published at or before `cutoff`. Unpublished
   * rows (`published_at IS NULL`) never match, so pending work is never lost.
   */
  async deletePublishedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.ctx.db.outboxEvent.deleteMany({
      where: { publishedAt: { not: null, lte: cutoff } },
    });
    return count;
  }
}
