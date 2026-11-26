import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import { scopeWhere } from '../scope.js';
import {
  GatewaysReadRepository,
  type CallbackStatus,
  type GatewayCallbackHealth,
} from '../../../domain/console-read/gateways-read.repository.js';

/** Read side of the operator Gateways endpoints (ADR 0005). */
@Injectable()
export class PrismaGatewaysReadRepository implements GatewaysReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Gateway ids that appear on any PaymentTransaction or stored Callback. */
  async gatewayIdsWithData(scope: ReadScope): Promise<string[]> {
    const [transactions, callbacks] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: scopeWhere(scope),
        distinct: ['gatewayId'],
        select: { gatewayId: true },
      }),
      this.prisma.webhookInbox.findMany({
        where: scopeWhere(scope),
        distinct: ['gatewayId'],
        select: { gatewayId: true },
      }),
    ]);
    return [
      ...new Set([...transactions, ...callbacks].map((r) => r.gatewayId)),
    ];
  }

  /** Gateway Connection ids in scope, by gateway id. */
  async connectionIds(scope: ReadScope): Promise<Map<string, string[]>> {
    const rows = await this.prisma.gatewayConnection.findMany({
      where: scopeWhere(scope),
      select: { id: true, gatewayId: true },
      orderBy: { id: 'asc' },
    });
    const byGateway = new Map<string, string[]>();
    for (const row of rows) {
      byGateway.set(row.gatewayId, [
        ...(byGateway.get(row.gatewayId) ?? []),
        row.id,
      ]);
    }
    return byGateway;
  }

  async callbackHealth(
    scope: ReadScope,
    gatewayId: string,
    since: Date,
  ): Promise<GatewayCallbackHealth> {
    const [grouped, last] = await Promise.all([
      this.prisma.webhookInbox.groupBy({
        by: ['status'],
        where: { ...scopeWhere(scope), gatewayId, receivedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.webhookInbox.aggregate({
        where: { ...scopeWhere(scope), gatewayId, receivedAt: { gte: since } },
        _max: { receivedAt: true },
      }),
    ]);
    const counts: Record<CallbackStatus, number> = {
      RECEIVED: 0,
      PROCESSING: 0,
      PROCESSED: 0,
      FAILED: 0,
    };
    for (const g of grouped) counts[g.status] = g._count._all;
    return { counts, lastCallbackAt: last._max.receivedAt };
  }
}
