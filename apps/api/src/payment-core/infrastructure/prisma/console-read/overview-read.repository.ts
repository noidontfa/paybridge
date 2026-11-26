import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import { Prisma } from '../../../../generated/prisma/client.js';
import {
  PAYMENT_STATUSES,
  type PaymentStatus,
} from '../../../domain/statuses.js';
import { TERMINAL_PAYMENT_STATUSES as CLOSED_STATUSES } from '../../../domain/rules/payment-transitions.js';
import { decimalToString } from '../mappers.js';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { scopeSql, scopeWhere } from '../scope.js';
import {
  OverviewReadRepository,
  type OverviewWindow,
  type OverviewData,
} from '../../../domain/repositories/console-read/overview-read.repository.js';

const RECENT_COUNT = 8;
const CURRENCY = 'VND';

/**
 * Read model behind the operator Overview (ADR 0005). Aggregates run in the
 * database; no transaction, no writes.
 */
@Injectable()
export class PrismaOverviewReadRepository implements OverviewReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview(
    scope: ReadScope,
    window: OverviewWindow,
  ): Promise<OverviewData> {
    const { from, to, bucketMs, bucketCount } = window;
    const inRange: Prisma.PaymentWhereInput = {
      ...scopeWhere(scope),
      createdAt: { gte: from, lte: to },
    };
    const fromMs = from.getTime();

    const [byStatus, volume, buckets, gateways, openReviewCount, recent] =
      await Promise.all([
        this.prisma.payment.groupBy({
          by: ['status'],
          where: inRange,
          _count: { _all: true },
        }),
        this.prisma.payment.aggregate({
          where: { ...inRange, status: 'SUCCEEDED' },
          _sum: { amount: true },
        }),
        // Rolling buckets counted from `from`; a Payment created exactly at
        // `to` falls in the last bucket.
        this.prisma.$queryRaw<{ idx: number; volume: string }[]>`
          SELECT LEAST(${bucketCount - 1}::int,
                   FLOOR((EXTRACT(EPOCH FROM created_at) * 1000 - ${fromMs}::float8)
                         / ${bucketMs}::float8)::int) AS idx,
                 SUM(amount)::text AS volume
          FROM core_payments
          WHERE status = 'SUCCEEDED' AND created_at >= ${from} AND created_at <= ${to}
            AND ${scopeSql(scope, 'organization_id')}
          GROUP BY idx`,
        // A Payment belongs to the gateway of its latest PaymentTransaction.
        this.prisma.$queryRaw<
          {
            gateway_id: string;
            status: PaymentStatus;
            count: bigint;
            volume: string;
          }[]
        >`
          SELECT t.gateway_id, p.status::text AS status,
                 COUNT(*) AS count, SUM(p.amount)::text AS volume
          FROM core_payments p
          JOIN LATERAL (
            SELECT gateway_id FROM core_payment_transactions
            WHERE payment_id = p.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ) t ON TRUE
          WHERE p.created_at >= ${from} AND p.created_at <= ${to}
            AND ${scopeSql(scope, 'p.organization_id')}
          GROUP BY t.gateway_id, p.status`,
        this.prisma.paymentTransaction.count({
          where: { ...scopeWhere(scope), status: 'REQUIRES_REVIEW' },
        }),
        this.prisma.payment.findMany({
          where: inRange,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: RECENT_COUNT,
          include: {
            transactions: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { gatewayId: true },
            },
          },
        }),
      ]);

    const counts = new Map(byStatus.map((r) => [r.status, r._count._all]));
    const countOf = (s: PaymentStatus) => counts.get(s) ?? 0;
    const paymentCount = PAYMENT_STATUSES.reduce((n, s) => n + countOf(s), 0);

    const series = Array.from({ length: bucketCount }, () => '0');
    for (const row of buckets) {
      series[Number(row.idx)] = decimalToString(new Prisma.Decimal(row.volume));
    }

    const perGateway = new Map<
      string,
      {
        count: number;
        volume: Prisma.Decimal;
        succeeded: number;
        closed: number;
      }
    >();
    for (const row of gateways) {
      const g = perGateway.get(row.gateway_id) ?? {
        count: 0,
        volume: new Prisma.Decimal(0),
        succeeded: 0,
        closed: 0,
      };
      const count = Number(row.count);
      g.count += count;
      if (row.status === 'SUCCEEDED') {
        g.volume = g.volume.plus(row.volume);
        g.succeeded += count;
      }
      if (CLOSED_STATUSES.includes(row.status)) g.closed += count;
      perGateway.set(row.gateway_id, g);
    }

    return {
      currency: CURRENCY,
      volume: decimalToString(volume._sum.amount ?? new Prisma.Decimal(0)),
      paymentCount,
      succeeded: countOf('SUCCEEDED'),
      closed: CLOSED_STATUSES.reduce((n, s) => n + countOf(s), 0),
      openReviewCount,
      volumeSeries: series,
      statusCounts: PAYMENT_STATUSES.map((status) => ({
        status,
        count: countOf(status),
      })),
      gateways: [...perGateway.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([gatewayId, g]) => ({
          gatewayId,
          count: g.count,
          volume: decimalToString(g.volume),
          succeeded: g.succeeded,
          closed: g.closed,
        })),
      recent: recent.map((p) => ({
        id: p.id,
        upstreamReference: p.merchantOrderId,
        amount: decimalToString(p.amount),
        status: p.status,
        gatewayId: p.transactions[0]?.gatewayId ?? null,
        createdAt: p.createdAt,
      })),
    };
  }
}
