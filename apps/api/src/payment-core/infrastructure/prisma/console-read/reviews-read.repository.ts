import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import { Prisma } from '../../../../generated/prisma/client.js';
import { REVIEW_REASONS, type ReviewReason } from '../../../domain/statuses.js';
import { decimalToString } from '../mappers.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import { scopeWhere } from '../scope.js';
import {
  escapeLike,
  providerReportedAmount,
  uuidNeedle,
} from './read-helpers.js';
import {
  ReviewsReadRepository,
  type ReviewListQuery,
  type ReviewRow,
  type ReviewCounts,
} from '../../../domain/console-read/reviews-read.repository.js';

/**
 * Read model behind the operator Reviews (ADR 0005). A Review is a
 * PaymentTransaction with a review reason: open while it is still
 * `REQUIRES_REVIEW`, closed once it has left that status. Read only.
 */
@Injectable()
export class PrismaReviewsReadRepository implements ReviewsReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, so the caller can tell whether another page exists. */
  async list(scope: ReadScope, query: ReviewListQuery): Promise<ReviewRow[]> {
    const rows = await this.prisma.paymentTransaction.findMany({
      where: this.where(scope, query),
      // The id breaks ties so a page boundary never repeats or skips a row.
      orderBy: [{ reviewOpenedAt: query.order }, { id: query.order }],
      take: query.limit + 1,
      include: { payment: true },
    });
    return rows.map((row) => ({
      id: row.id,
      // The filter guarantees both are set.
      reason: row.reviewReason as ReviewReason,
      state: row.status === 'REQUIRES_REVIEW' ? 'open' : 'closed',
      gatewayId: row.gatewayId,
      transactionStatus: row.status,
      refundRequired: row.refundRequired,
      reviewOpenedAt: row.reviewOpenedAt as Date,
      providerReportedAmount: providerReportedAmount(row.providerMetadata),
      payment: {
        id: row.payment.id,
        upstreamReference: row.payment.merchantOrderId,
        amount: decimalToString(row.payment.amount),
        currency: row.payment.currency,
        status: row.payment.status,
      },
    }));
  }

  /** Open and total Reviews, and open ones by reason (every reason present). */
  async counts(scope: ReadScope): Promise<ReviewCounts> {
    const [total, openByReason] = await Promise.all([
      this.prisma.paymentTransaction.count({
        where: { ...scopeWhere(scope), reviewReason: { not: null } },
      }),
      this.prisma.paymentTransaction.groupBy({
        by: ['reviewReason'],
        where: {
          ...scopeWhere(scope),
          status: 'REQUIRES_REVIEW',
          reviewReason: { not: null },
        },
        _count: { _all: true },
      }),
    ]);
    const byReason = Object.fromEntries(
      REVIEW_REASONS.map((reason) => [reason, 0]),
    ) as Record<ReviewReason, number>;
    for (const group of openByReason) {
      if (group.reviewReason) byReason[group.reviewReason] = group._count._all;
    }
    const open = Object.values(byReason).reduce((a, b) => a + b, 0);
    return { open, total, byReason };
  }

  private where(
    scope: ReadScope,
    query: ReviewListQuery,
  ): Prisma.PaymentTransactionWhereInput {
    const { filters, after } = query;
    const and: Prisma.PaymentTransactionWhereInput[] = [
      scopeWhere(scope),
      { reviewReason: { not: null }, reviewOpenedAt: { not: null } },
      filters.state === 'open'
        ? { status: 'REQUIRES_REVIEW' }
        : { status: { not: 'REQUIRES_REVIEW' } },
    ];
    if (filters.reason) and.push({ reviewReason: filters.reason });
    if (filters.gatewayId) and.push({ gatewayId: filters.gatewayId });
    if (filters.q) {
      const needle = filters.q;
      const id = uuidNeedle(needle);
      and.push({
        OR: [
          ...(id ? [{ id }, { paymentId: id }] : []),
          {
            payment: {
              merchantOrderId: {
                contains: escapeLike(needle),
                mode: 'insensitive' as const,
              },
            },
          },
        ],
      });
    }
    if (after) {
      const cmp = query.order === 'asc' ? 'gt' : 'lt';
      const value = new Date(after.value);
      and.push({
        OR: [
          { reviewOpenedAt: { [cmp]: value } },
          { reviewOpenedAt: value, id: { [cmp]: after.id } },
        ],
      });
    }
    return { AND: and };
  }
}
