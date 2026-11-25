import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { PrismaService } from '../../../../database/prisma.service.js';
import { Prisma } from '../../../../generated/prisma/client.js';
import {
  REVIEW_REASONS,
  type AttemptStatus,
  type PaymentStatus,
  type ReviewReason,
} from '../../../domain/statuses.js';
import { decimalToString } from '../mappers.js';

export type ReviewState = 'open' | 'closed';

export interface ReviewListFilters {
  readonly reason?: ReviewReason;
  readonly gatewayId?: string;
  /** Payment id or Attempt Key (exact, any case) or part of the Upstream Reference. */
  readonly q?: string;
  readonly state: ReviewState;
}

export interface ReviewListQuery {
  readonly filters: ReviewListFilters;
  readonly order: 'asc' | 'desc';
  /** Opening time (ISO) and Attempt Key of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface ReviewRow {
  /** The Attempt Key. */
  readonly id: string;
  readonly reason: ReviewReason;
  readonly state: ReviewState;
  readonly gatewayId: string;
  readonly transactionStatus: AttemptStatus;
  readonly refundRequired: boolean;
  readonly reviewOpenedAt: Date;
  readonly providerReportedAmount: string | null;
  readonly payment: {
    readonly id: string;
    readonly upstreamReference: string;
    readonly amount: string;
    readonly currency: string;
    readonly status: PaymentStatus;
  };
}

export interface ReviewCounts {
  readonly open: number;
  readonly total: number;
  readonly byReason: Record<ReviewReason, number>;
}

/** Makes `%`, `_` and `\` match themselves in a LIKE pattern (Prisma does not). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * The amount the provider reported, kept by the seed (and later by Core) in
 * `providerMetadata.providerReportedAmount`. Null when there is none.
 */
function reportedAmount(metadata: Prisma.JsonValue): string | null {
  if (metadata === null || typeof metadata !== 'object') return null;
  if (Array.isArray(metadata)) return null;
  const value = metadata['providerReportedAmount'];
  const text =
    typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return DECIMAL.test(text) ? text : null;
}

/**
 * Read model behind the operator Reviews (ADR 0005). A Review is a
 * PaymentTransaction with a review reason: open while it is still
 * `REQUIRES_REVIEW`, closed once it has left that status. Read only.
 */
@Injectable()
export class ReviewsReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, so the caller can tell whether another page exists. */
  async list(query: ReviewListQuery): Promise<ReviewRow[]> {
    const rows = await this.prisma.paymentTransaction.findMany({
      where: this.where(query),
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
      providerReportedAmount: reportedAmount(row.providerMetadata),
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
  async counts(): Promise<ReviewCounts> {
    const [total, openByReason] = await Promise.all([
      this.prisma.paymentTransaction.count({
        where: { reviewReason: { not: null } },
      }),
      this.prisma.paymentTransaction.groupBy({
        by: ['reviewReason'],
        where: { status: 'REQUIRES_REVIEW', reviewReason: { not: null } },
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

  private where(query: ReviewListQuery): Prisma.PaymentTransactionWhereInput {
    const { filters, after } = query;
    const and: Prisma.PaymentTransactionWhereInput[] = [
      { reviewReason: { not: null }, reviewOpenedAt: { not: null } },
      filters.state === 'open'
        ? { status: 'REQUIRES_REVIEW' }
        : { status: { not: 'REQUIRES_REVIEW' } },
    ];
    if (filters.reason) and.push({ reviewReason: filters.reason });
    if (filters.gatewayId) and.push({ gatewayId: filters.gatewayId });
    if (filters.q) {
      const needle = filters.q;
      and.push({
        OR: [
          ...(isUuid(needle)
            ? [
                { id: needle.toLowerCase() },
                { paymentId: needle.toLowerCase() },
              ]
            : []),
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
