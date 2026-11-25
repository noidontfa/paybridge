import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type { WebhookInboxStatus } from '../../../domain/records.js';
import {
  escapeLike,
  toStringRecord,
  uuidNeedle,
} from './developer-views.shared.js';

export interface CallbackListFilters {
  readonly gatewayId?: string;
  readonly status?: WebhookInboxStatus;
  /** Callback id or Attempt Key (exact), Provider Event id, Payment id or Upstream Reference. */
  readonly q?: string;
}

export interface CallbackListQuery {
  readonly filters: CallbackListFilters;
  /** `receivedAt` and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface CallbackListRow {
  readonly id: string;
  readonly gatewayId: string;
  readonly providerEventId: string | null;
  readonly attemptKey: string | null;
  readonly status: WebhookInboxStatus;
  readonly attempts: number;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface CallbackDetailRow extends CallbackListRow {
  readonly headers: Record<string, string>;
  readonly query: Record<string, string>;
  /** The body exactly as received, decoded as UTF-8 text. */
  readonly rawBody: string;
  readonly lastError: string | null;
  /** Payment of the PaymentTransaction the Attempt Key names, if one exists. */
  readonly paymentId: string | null;
}

const LIST_SELECT = {
  id: true,
  gatewayId: true,
  providerEventId: true,
  attemptKey: true,
  status: true,
  attempts: true,
  receivedAt: true,
  processedAt: true,
} satisfies Prisma.WebhookInboxSelect;

/** Read model behind the operator Callbacks pages (stored in `core_webhook_inbox`). */
@Injectable()
export class CallbacksReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, newest first, so the caller can tell whether another page exists. */
  async list(query: CallbackListQuery): Promise<CallbackListRow[]> {
    return this.prisma.webhookInbox.findMany({
      where: await this.where(query),
      // The id breaks ties so a page boundary never repeats or skips a row.
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: LIST_SELECT,
    });
  }

  async findById(id: string): Promise<CallbackDetailRow | null> {
    const row = await this.prisma.webhookInbox.findUnique({ where: { id } });
    if (!row) return null;
    // No foreign key on the Attempt Key: a Callback may name an unknown attempt.
    const attempt = row.attemptKey
      ? await this.prisma.paymentTransaction.findUnique({
          where: { id: row.attemptKey },
          select: { paymentId: true },
        })
      : null;
    return {
      id: row.id,
      gatewayId: row.gatewayId,
      providerEventId: row.providerEventId,
      attemptKey: row.attemptKey,
      status: row.status,
      attempts: row.attempts,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
      headers: toStringRecord(row.headers),
      query: toStringRecord(row.query),
      rawBody: Buffer.from(row.rawBody).toString('utf8'),
      lastError: row.lastError,
      paymentId: attempt?.paymentId ?? null,
    };
  }

  private async where(
    query: CallbackListQuery,
  ): Promise<Prisma.WebhookInboxWhereInput> {
    const { filters, after } = query;
    const and: Prisma.WebhookInboxWhereInput[] = [];
    if (filters.gatewayId) and.push({ gatewayId: filters.gatewayId });
    if (filters.status) and.push({ status: filters.status });
    if (filters.q) {
      const needle = filters.q;
      const id = uuidNeedle(needle);
      // The Attempt Keys of Payments that match the needle (no relation to follow).
      const keys = await this.prisma.paymentTransaction.findMany({
        where: {
          payment: {
            OR: [
              ...(id ? [{ id }] : []),
              {
                merchantOrderId: {
                  contains: escapeLike(needle),
                  mode: 'insensitive' as const,
                },
              },
            ],
          },
        },
        select: { id: true },
        take: 1000,
      });
      and.push({
        OR: [
          ...(id ? [{ id }, { attemptKey: id }] : []),
          {
            providerEventId: {
              contains: escapeLike(needle),
              mode: 'insensitive',
            },
          },
          { attemptKey: { in: keys.map((key) => key.id) } },
        ],
      });
    }
    if (after) {
      const value = new Date(after.value);
      and.push({
        OR: [
          { receivedAt: { lt: value } },
          { receivedAt: value, id: { lt: after.id } },
        ],
      });
    }
    return { AND: and };
  }
}
