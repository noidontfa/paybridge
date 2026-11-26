import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { ReadScope } from '../../../payment-core/port/organization-scope.js';
import {
  WebhookDeliveriesReadRepository,
  type WebhookDeliveryDetailRow,
  type WebhookDeliveryListQuery,
  type WebhookDeliveryListRow,
} from '../../domain/repositories/webhook-deliveries-read.repository.js';

const organizationOf = (scope: ReadScope) =>
  scope.kind === 'organization' ? { organizationId: scope.organizationId } : {};

const LIST_SELECT = {
  id: true,
  eventId: true,
  eventKind: true,
  paymentId: true,
  status: true,
  attempts: true,
  createdAt: true,
  endpoint: { select: { id: true, url: true } },
  attemptRows: {
    select: { attemptedAt: true, httpStatus: true },
    orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} satisfies Prisma.WebhookDeliverySelect;

type ListRecord = Prisma.WebhookDeliveryGetPayload<{
  select: typeof LIST_SELECT;
}>;

function toListRow(row: ListRecord): WebhookDeliveryListRow {
  const last = row.attemptRows[0];
  return {
    id: row.id,
    endpoint: row.endpoint,
    eventId: row.eventId,
    eventKind: row.eventKind,
    paymentId: row.paymentId,
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: last?.attemptedAt ?? null,
    lastHttpStatus: last?.httpStatus ?? null,
    createdAt: row.createdAt,
  };
}

/** Read model over `wh_deliveries` and `wh_delivery_attempts` (ADR 0005). */
@Injectable()
export class PrismaWebhookDeliveriesReadRepository extends WebhookDeliveriesReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {
    super();
  }

  async list(
    scope: ReadScope,
    query: WebhookDeliveryListQuery,
  ): Promise<WebhookDeliveryListRow[]> {
    const { filters, after } = query;
    const and: Prisma.WebhookDeliveryWhereInput[] = [organizationOf(scope)];
    if (filters.endpointId) and.push({ endpointId: filters.endpointId });
    if (filters.status) and.push({ status: filters.status });
    if (filters.kind) and.push({ eventKind: filters.kind });
    if (filters.paymentId) and.push({ paymentId: filters.paymentId });
    if (after) {
      const at = new Date(after.value);
      and.push({
        OR: [
          { createdAt: { lt: at } },
          { createdAt: at, id: { lt: after.id } },
        ],
      });
    }
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { AND: and },
      // The id breaks ties so a page boundary never repeats or skips a row.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: LIST_SELECT,
    });
    return rows.map(toListRow);
  }

  async findById(
    scope: ReadScope,
    id: string,
  ): Promise<WebhookDeliveryDetailRow | null> {
    if (!isUuid(id)) return null;
    const row = await this.prisma.webhookDelivery.findFirst({
      where: { id, ...organizationOf(scope) },
      select: { ...LIST_SELECT, eventCreatedAt: true },
    });
    if (!row) return null;
    const attempts = await this.prisma.webhookDeliveryAttempt.findMany({
      where: { deliveryId: row.id, ...organizationOf(scope) },
      orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }],
    });
    return {
      ...toListRow(row),
      eventCreatedAt: row.eventCreatedAt,
      history: attempts.map((a) => ({
        id: a.id,
        attemptedAt: a.attemptedAt,
        succeeded: a.succeeded,
        httpStatus: a.httpStatus,
        durationMs: a.durationMs,
        responseBody: a.responseBody,
        error: a.error,
        triggeredBy: a.triggeredByUserId
          ? {
              userId: a.triggeredByUserId,
              role: a.triggeredByRole ?? '',
              name: a.triggeredByName ?? '',
            }
          : null,
      })),
    };
  }

  async latestOutcomes(
    scope: ReadScope,
    endpointIds: readonly string[],
    count: number,
  ): Promise<Map<string, boolean[]>> {
    const entries = await Promise.all(
      endpointIds.map(async (endpointId) => {
        const rows = await this.prisma.webhookDeliveryAttempt.findMany({
          where: { ...organizationOf(scope), delivery: { endpointId } },
          orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }],
          take: count,
          select: { succeeded: true },
        });
        return [endpointId, rows.map((r) => r.succeeded)] as const;
      }),
    );
    return new Map(entries);
  }
}
