import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import { Prisma } from '../../../../generated/prisma/client.js';
import { decimalToString } from '../mappers.js';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { scopeWhere } from '../scope.js';
import { escapeLike, uuidNeedle } from './read-helpers.js';
import {
  PaymentsReadRepository,
  type PaymentListQuery,
  type PaymentListRow,
} from '../../../domain/repositories/console-read/payments-read.repository.js';

/**
 * Read model behind the operator Payments list (ADR 0005). Read only: it
 * uses the shared client directly, never a transaction.
 */
@Injectable()
export class PrismaPaymentsReadRepository implements PaymentsReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, so the caller can tell whether another page exists. */
  async list(
    scope: ReadScope,
    query: PaymentListQuery,
  ): Promise<PaymentListRow[]> {
    const rows = await this.prisma.payment.findMany({
      where: this.where(scope, query),
      // The id breaks ties so a page boundary never repeats or skips a row.
      orderBy: [{ [query.sort]: query.order }, { id: query.order }],
      take: query.limit + 1,
      include: {
        transactions: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { gatewayId: true, status: true },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      upstreamReference: row.merchantOrderId,
      amount: decimalToString(row.amount),
      currency: row.currency,
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      latestTransaction: row.transactions[0] ?? null,
    }));
  }

  private where(
    scope: ReadScope,
    query: PaymentListQuery,
  ): Prisma.PaymentWhereInput {
    const { filters, after } = query;
    const and: Prisma.PaymentWhereInput[] = [scopeWhere(scope)];
    if (filters.status) and.push({ status: filters.status });
    if (filters.gatewayId) {
      and.push({ transactions: { some: { gatewayId: filters.gatewayId } } });
    }
    if (filters.q) {
      const needle = filters.q;
      const id = uuidNeedle(needle);
      and.push({
        OR: [
          ...(id ? [{ id }] : []),
          {
            merchantOrderId: {
              contains: escapeLike(needle),
              mode: 'insensitive',
            },
          },
        ],
      });
    }
    if (filters.createdFrom)
      and.push({ createdAt: { gte: filters.createdFrom } });
    if (filters.createdTo) and.push({ createdAt: { lte: filters.createdTo } });
    if (after) {
      const cmp = query.order === 'asc' ? 'gt' : 'lt';
      const value =
        query.sort === 'amount'
          ? new Prisma.Decimal(after.value)
          : new Date(after.value);
      and.push({
        OR: [
          { [query.sort]: { [cmp]: value } },
          { [query.sort]: value, id: { [cmp]: after.id } },
        ],
      });
    }
    return { AND: and };
  }
}
