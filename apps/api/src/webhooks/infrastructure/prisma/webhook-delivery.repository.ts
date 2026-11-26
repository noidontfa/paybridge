import type { Prisma } from '../../../generated/prisma/client.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../../payment-core/port/organization-scope.js';
import type {
  DeliveryAttemptResult,
  NewWebhookDelivery,
  WebhookDelivery,
} from '../../domain/entities/webhook-delivery.js';
import { WebhookDeliveryRepository } from '../../domain/repositories/webhook-delivery.repository.js';
import type { DbContext } from './db.js';

const organizationOf = (scope: ReadScope) =>
  scope.kind === 'organization' ? { organizationId: scope.organizationId } : {};

/** Deliveries in `wh_deliveries`, attempts in `wh_delivery_attempts`. */
export class PrismaWebhookDeliveryRepository extends WebhookDeliveryRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async createMissing(
    scope: OrganizationScope,
    deliveries: readonly NewWebhookDelivery[],
  ): Promise<void> {
    if (deliveries.length === 0) return;
    await this.ctx.db.webhookDelivery.createMany({
      data: deliveries.map((d) => ({
        id: d.id,
        organizationId: scope.organizationId,
        endpointId: d.endpointId,
        eventId: d.eventId,
        eventKind: d.eventKind,
        eventCreatedAt: d.eventCreatedAt,
        paymentId: d.paymentId,
        payload: (d.data ?? null) as Prisma.InputJsonValue,
      })),
      // The (event, endpoint) unique index makes a repeat a no-op.
      skipDuplicates: true,
    });
  }

  async pendingIdsOfEvent(
    scope: OrganizationScope,
    eventId: string,
  ): Promise<string[]> {
    const rows = await this.ctx.db.webhookDelivery.findMany({
      where: {
        organizationId: scope.organizationId,
        eventId,
        status: 'PENDING',
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  async findById(
    scope: ReadScope,
    id: string,
  ): Promise<WebhookDelivery | null> {
    const row = await this.ctx.db.webhookDelivery.findFirst({
      where: { id, ...organizationOf(scope) },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      endpointId: row.endpointId,
      eventId: row.eventId,
      eventKind: row.eventKind,
      eventCreatedAt: row.eventCreatedAt,
      paymentId: row.paymentId,
      data: row.payload,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
    };
  }

  async claim(
    scope: ReadScope,
    id: string,
    now: Date,
    staleBefore: Date,
  ): Promise<WebhookDelivery | null> {
    // One conditional UPDATE: of two workers racing, only one matches.
    const { count } = await this.ctx.db.webhookDelivery.updateMany({
      where: {
        id,
        ...organizationOf(scope),
        ...dueAndFree(now, staleBefore),
      },
      data: { lockedAt: now },
    });
    return count === 0 ? null : this.findById(scope, id);
  }

  async findDue(
    scope: ReadScope,
    now: Date,
    staleBefore: Date,
    limit: number,
  ): Promise<{ id: string; attempts: number }[]> {
    return this.ctx.db.webhookDelivery.findMany({
      where: { ...organizationOf(scope), ...dueAndFree(now, staleBefore) },
      select: { id: true, attempts: true },
      orderBy: [{ nextAttemptAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: limit,
    });
  }

  async deleteFinishedBefore(scope: ReadScope, before: Date): Promise<number> {
    const where = {
      ...organizationOf(scope),
      status: { in: ['SUCCEEDED', 'FAILED'] },
      createdAt: { lt: before },
    } satisfies Prisma.WebhookDeliveryWhereInput;
    await this.ctx.db.webhookDeliveryAttempt.deleteMany({
      where: { delivery: where },
    });
    const { count } = await this.ctx.db.webhookDelivery.deleteMany({ where });
    return count;
  }

  async recordAttempt(
    scope: OrganizationScope,
    deliveryId: string,
    attemptId: string,
    result: DeliveryAttemptResult,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.ctx.db.webhookDeliveryAttempt.create({
      data: {
        id: attemptId,
        organizationId: scope.organizationId,
        deliveryId,
        attemptedAt: result.attemptedAt,
        succeeded: result.succeeded,
        httpStatus: result.httpStatus,
        durationMs: result.durationMs,
        responseBody: result.responseBody,
        error: result.error,
      },
    });
    await this.ctx.db.webhookDelivery.updateMany({
      where: { id: deliveryId, organizationId: scope.organizationId },
      data: {
        status: result.succeeded
          ? 'SUCCEEDED'
          : nextAttemptAt
            ? 'PENDING'
            : 'FAILED',
        attempts: { increment: 1 },
        nextAttemptAt: result.succeeded ? null : nextAttemptAt,
        lockedAt: null,
      },
    });
  }
}

/** Waiting, due at `now`, and not held by a live worker. */
function dueAndFree(
  now: Date,
  staleBefore: Date,
): Prisma.WebhookDeliveryWhereInput {
  return {
    status: 'PENDING',
    AND: [
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      { OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
    ],
  };
}
