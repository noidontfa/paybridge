import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { escapeLike, toStringRecord, uuidNeedle } from './read-helpers.js';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { scopeWhere } from '../scope.js';
import {
  CallbacksReadRepository,
  type CallbackListQuery,
  type CallbackListRow,
  type CallbackDetailRow,
} from '../../../domain/repositories/console-read/callbacks-read.repository.js';

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
export class PrismaCallbacksReadRepository implements CallbacksReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, newest first, so the caller can tell whether another page exists. */
  async list(
    scope: ReadScope,
    query: CallbackListQuery,
  ): Promise<CallbackListRow[]> {
    return this.prisma.webhookInbox.findMany({
      where: await this.where(scope, query),
      // The id breaks ties so a page boundary never repeats or skips a row.
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: LIST_SELECT,
    });
  }

  async findById(
    scope: ReadScope,
    id: string,
  ): Promise<CallbackDetailRow | null> {
    const key = uuidNeedle(id);
    if (!key) return null;
    const row = await this.prisma.webhookInbox.findUnique({
      where: { id: key, ...scopeWhere(scope) },
    });
    if (!row) return null;
    // No foreign key on the Attempt Key: a Callback may name an unknown attempt.
    const attempt = row.attemptKey
      ? await this.prisma.paymentTransaction.findUnique({
          where: { id: row.attemptKey, ...scopeWhere(scope) },
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
    scope: ReadScope,
    query: CallbackListQuery,
  ): Promise<Prisma.WebhookInboxWhereInput> {
    const { filters, after } = query;
    const and: Prisma.WebhookInboxWhereInput[] = [scopeWhere(scope)];
    if (filters.gatewayId) and.push({ gatewayId: filters.gatewayId });
    if (filters.status) and.push({ status: filters.status });
    if (filters.q) {
      const needle = filters.q;
      const id = uuidNeedle(needle);
      // The Attempt Keys of Payments that match the needle (no relation to follow).
      const keys = await this.prisma.paymentTransaction.findMany({
        where: {
          ...scopeWhere(scope),
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
