import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type { OutboxEventType } from '../../../domain/records.js';
import { escapeLike, uuidNeedle } from './read-helpers.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import { scopeWhere } from '../scope.js';

export interface PaymentEventListFilters {
  readonly type?: OutboxEventType;
  /** `true`: relay has published it; `false`: still waiting. */
  readonly published?: boolean;
  /** Event id or Payment id (exact), or part of the Upstream Reference. */
  readonly q?: string;
}

export interface PaymentEventListQuery {
  readonly filters: PaymentEventListFilters;
  /** `createdAt` and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface PaymentEventSummaryRow {
  readonly id: string;
  readonly type: OutboxEventType;
  readonly paymentId: string;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

export interface PaymentEventDetailRow extends PaymentEventSummaryRow {
  readonly payload: Record<string, unknown>;
}

/** Read model behind the operator Payment Events pages (stored in `core_outbox_events`). */
@Injectable()
export class PaymentEventsReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, newest first, without payloads. */
  async list(
    scope: ReadScope,
    query: PaymentEventListQuery,
  ): Promise<PaymentEventSummaryRow[]> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: this.where(scope, query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        eventType: true,
        paymentId: true,
        createdAt: true,
        publishedAt: true,
      },
    });
    return rows.map(({ eventType, ...row }) => ({ ...row, type: eventType }));
  }

  async findById(
    scope: ReadScope,
    id: string,
  ): Promise<PaymentEventDetailRow | null> {
    const key = uuidNeedle(id);
    if (!key) return null;
    const row = await this.prisma.outboxEvent.findUnique({
      where: { id: key, ...scopeWhere(scope) },
    });
    if (!row) return null;
    return {
      id: row.id,
      type: row.eventType,
      paymentId: row.paymentId,
      createdAt: row.createdAt,
      publishedAt: row.publishedAt,
      payload:
        typeof row.payload === 'object' &&
        row.payload !== null &&
        !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {},
    };
  }

  private where(
    scope: ReadScope,
    query: PaymentEventListQuery,
  ): Prisma.OutboxEventWhereInput {
    const { filters, after } = query;
    const and: Prisma.OutboxEventWhereInput[] = [scopeWhere(scope)];
    if (filters.type) and.push({ eventType: filters.type });
    if (filters.published !== undefined) {
      and.push({ publishedAt: filters.published ? { not: null } : null });
    }
    if (filters.q) {
      const id = uuidNeedle(filters.q);
      and.push({
        OR: [
          ...(id ? [{ id }, { paymentId: id }] : []),
          {
            payment: {
              merchantOrderId: {
                contains: escapeLike(filters.q),
                mode: 'insensitive',
              },
            },
          },
        ],
      });
    }
    if (after) {
      const value = new Date(after.value);
      and.push({
        OR: [
          { createdAt: { lt: value } },
          { createdAt: value, id: { lt: after.id } },
        ],
      });
    }
    return { AND: and };
  }
}
