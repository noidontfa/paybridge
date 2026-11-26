import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import { Prisma } from '../../../../generated/prisma/client.js';
import type { PaymentStatus, AttemptStatus } from '../../../domain/statuses.js';
import { decimalToString } from '../mappers.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import { scopeWhere } from '../scope.js';
import { escapeLike, uuidNeedle } from './read-helpers.js';

export type PaymentSortColumn = 'createdAt' | 'amount';

export interface PaymentListFilters {
  readonly status?: PaymentStatus;
  /** Matches a Payment that has a PaymentTransaction on this gateway. */
  readonly gatewayId?: string;
  /** Payment id (exact) or part of the Upstream Reference (any case). */
  readonly q?: string;
  /** Inclusive bounds on `createdAt`. */
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

export interface PaymentListQuery {
  readonly filters: PaymentListFilters;
  readonly sort: PaymentSortColumn;
  readonly order: 'asc' | 'desc';
  /** Sort-key value and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface PaymentListRow {
  readonly id: string;
  readonly upstreamReference: string;
  /** Decimal string in the major unit. */
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Latest PaymentTransaction: greatest `createdAt`, ties broken by id. */
  readonly latestTransaction: {
    readonly gatewayId: string;
    readonly status: AttemptStatus;
  } | null;
}

/**
 * Read model behind the operator Payments list (ADR 0005). Read only: it
 * uses the shared client directly, never a transaction.
 */
@Injectable()
export class PaymentsReadRepository {
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
