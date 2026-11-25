import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { PrismaService } from '../../../../database/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type {
  AttemptStatus,
  PaymentStatus,
  ReviewReason,
} from '../../../domain/statuses.js';
import { decimalToString } from '../mappers.js';

export interface TransitionRow {
  readonly id: string;
  readonly entityType: 'PAYMENT' | 'PAYMENT_TRANSACTION' | 'REFUND';
  readonly entityId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly trigger: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface PaymentEventRow {
  readonly id: string;
  readonly type: string;
  readonly paymentId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

export interface AttemptDetailRow {
  readonly id: string;
  readonly gatewayId: string;
  readonly status: AttemptStatus;
  readonly providerRef: string | null;
  readonly nextAction: unknown;
  readonly reviewReason: ReviewReason | null;
  readonly reviewOpenedAt: Date | null;
  readonly refundRequired: boolean;
  /** From `providerMetadata.providerReportedAmount`, when present. */
  readonly providerReportedAmount: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly transitions: TransitionRow[];
}

export interface PaymentDetailRow {
  readonly id: string;
  readonly upstreamReference: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly attempts: AttemptDetailRow[];
  readonly events: PaymentEventRow[];
}

function reportedAmount(metadata: Prisma.JsonValue | null): string | null {
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const value = metadata.providerReportedAmount;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

/**
 * Read model behind the operator Payment detail (ADR 0005). Read only: it
 * uses the shared client directly, never a transaction.
 */
@Injectable()
export class PaymentDetailReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The Payment with attempts, transitions and events; null if none (or not a UUID). */
  async find(id: string): Promise<PaymentDetailRow | null> {
    if (!isUuid(id)) return null;
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        transactions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        outboxEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!payment) return null;

    const transitions = await this.prisma.statusTransition.findMany({
      where: {
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
        providerReportedAmount: reportedAmount(t.providerMetadata),
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
