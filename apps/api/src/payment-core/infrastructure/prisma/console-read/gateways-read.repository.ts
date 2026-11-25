import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';

export const CALLBACK_STATUSES = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export interface GatewayCallbackHealth {
  /** Callbacks received since the cutoff, by status (every status present). */
  readonly counts: Record<CallbackStatus, number>;
  /** Latest `receivedAt` over all stored Callbacks, or null when none. */
  readonly lastCallbackAt: Date | null;
}

/** Read side of the operator Gateways endpoints (ADR 0005). */
@Injectable()
export class GatewaysReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Gateway ids that appear on any PaymentTransaction or stored Callback. */
  async gatewayIdsWithData(): Promise<string[]> {
    const [transactions, callbacks] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        distinct: ['gatewayId'],
        select: { gatewayId: true },
      }),
      this.prisma.webhookInbox.findMany({
        distinct: ['gatewayId'],
        select: { gatewayId: true },
      }),
    ]);
    return [
      ...new Set([...transactions, ...callbacks].map((r) => r.gatewayId)),
    ];
  }

  async callbackHealth(
    gatewayId: string,
    since: Date,
  ): Promise<GatewayCallbackHealth> {
    const [grouped, last] = await Promise.all([
      this.prisma.webhookInbox.groupBy({
        by: ['status'],
        where: { gatewayId, receivedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.webhookInbox.aggregate({
        where: { gatewayId },
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
