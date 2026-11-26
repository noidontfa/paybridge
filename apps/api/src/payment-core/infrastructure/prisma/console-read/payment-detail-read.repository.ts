import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import { decimalToString } from '../mappers.js';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { scopeWhere } from '../scope.js';
import { providerReportedAmount, uuidNeedle } from './read-helpers.js';
import {
  PaymentDetailReadRepository,
  type PaymentDetailRow,
} from '../../../domain/repositories/console-read/payment-detail-read.repository.js';

/**
 * Read model behind the operator Payment detail (ADR 0005). Read only: it
 * uses the shared client directly, never a transaction.
 */
@Injectable()
export class PrismaPaymentDetailReadRepository implements PaymentDetailReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The Payment with attempts, transitions and events; null if none (or not a UUID). */
  async find(scope: ReadScope, id: string): Promise<PaymentDetailRow | null> {
    const key = uuidNeedle(id);
    if (!key) return null;
    const payment = await this.prisma.payment.findUnique({
      where: { id: key, ...scopeWhere(scope) },
      include: {
        transactions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        outboxEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!payment) return null;

    const transitions = await this.prisma.statusTransition.findMany({
      where: {
        ...scopeWhere(scope),
        entityType: 'PAYMENT_TRANSACTION',
        entityId: { in: payment.transactions.map((t) => t.id) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return {
      id: payment.id,
      upstreamReference: payment.merchantOrderId,
      amount: decimalToString(payment.amount),
      currency: payment.currency,
      status: payment.status,
      expiresAt: payment.expiresAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      attempts: payment.transactions.map((t) => ({
        id: t.id,
        gatewayId: t.gatewayId,
        status: t.status,
        providerRef: t.providerRef,
        nextAction: t.nextAction,
        reviewReason: t.reviewReason,
        reviewOpenedAt: t.reviewOpenedAt,
        refundRequired: t.refundRequired,
        providerReportedAmount: providerReportedAmount(t.providerMetadata),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        transitions: transitions.filter((s) => s.entityId === t.id),
      })),
      events: payment.outboxEvents.map((e) => ({
        id: e.id,
        type: e.eventType,
        paymentId: e.paymentId,
        payload: e.payload as Record<string, unknown>,
        createdAt: e.createdAt,
        publishedAt: e.publishedAt,
      })),
    };
  }
}
