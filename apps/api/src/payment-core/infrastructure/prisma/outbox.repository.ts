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
}
