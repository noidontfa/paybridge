import type {
  NewPayment,
  Payment,
  PaymentChanges,
} from '../../domain/entities/payment.js';
import type {
  NewPaymentTransaction,
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../../domain/entities/payment-transaction.js';
import type { ReviewReason } from '../../domain/statuses.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../domain/value-objects/organization-scope.js';
import type { PaymentRepository } from '../../domain/repositories/repositories.js';
import type { DbContext } from './db.js';
import {
  definedOnly,
  jsonInput,
  toDecimal,
  toPayment,
  toPaymentTransaction,
} from './mappers.js';
import { scopeSql, scopeWhere } from './scope.js';
import { rethrowUniqueViolation } from './unique-violation.js';

const ATTEMPTS_OLDEST_FIRST = {
  orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
};

/**
 * The Payment aggregate: a Payment plus its attempts. No Refunds in Phase 1.
 * Every method takes the Organization scope first (ADR 0006): a Payment of
 * another Organization is simply not found.
 */
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly ctx: DbContext) {}

  async findById(scope: ReadScope, id: string): Promise<Payment | null> {
    const row = await this.ctx.db.payment.findUnique({
      where: { id, ...scopeWhere(scope) },
      include: { transactions: ATTEMPTS_OLDEST_FIRST },
    });
    return row ? toPayment(row, row.transactions) : null;
  }

  /**
   * Locks the Payment row (`SELECT ... FOR UPDATE`) until the surrounding
   * transaction ends, then loads the aggregate. Every use case that changes a
   * Payment or its attempts calls this first. Only valid inside
   * `TransactionRunner.run`.
   */
  async findForUpdate(scope: ReadScope, id: string): Promise<Payment | null> {
    if (!this.ctx.inTransaction) {
      throw new Error(
        'findForUpdate must run inside TransactionRunner.run: a lock outside a transaction is released at once',
      );
    }
    const locked = await this.ctx.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM core_payments
      WHERE id = ${id}::uuid AND ${scopeSql(scope, 'organization_id')}
      FOR UPDATE`;
    if (locked.length === 0) return null;
    return this.findById(scope, id);
  }

  async create(
    scope: OrganizationScope,
    payment: NewPayment,
  ): Promise<Payment> {
    const row = await rethrowUniqueViolation(
      this.ctx.db.payment.create({
        data: {
          id: payment.id,
          organizationId: scope.organizationId,
          merchantOrderId: payment.merchantOrderId,
          amount: toDecimal(payment.amount),
          currency: payment.currency,
          status: payment.status,
          expiresAt: payment.expiresAt,
          ...(payment.checkoutOrigin && {
            pricingPlanId: payment.checkoutOrigin.pricingPlanId,
            pricingPlanName: payment.checkoutOrigin.pricingPlanName,
            customerRef: payment.checkoutOrigin.customerReference,
            customerEmail: payment.checkoutOrigin.customerEmail,
          }),
        },
      }),
    );
    return toPayment(row, []);
  }

  async update(
    scope: ReadScope,
    id: string,
    changes: PaymentChanges,
  ): Promise<Payment> {
    const row = await this.ctx.db.payment.update({
      where: { id, ...scopeWhere(scope) },
      data: definedOnly(changes),
      include: { transactions: ATTEMPTS_OLDEST_FIRST },
    });
    return toPayment(row, row.transactions);
  }

  async createAttempt(
    scope: OrganizationScope,
    attempt: NewPaymentTransaction,
  ): Promise<PaymentTransaction> {
    const row = await rethrowUniqueViolation(
      this.ctx.db.paymentTransaction.create({
        data: {
          id: attempt.id,
          organizationId: scope.organizationId,
          paymentId: attempt.paymentId,
          gatewayId: attempt.gatewayId,
          status: attempt.status,
          providerRef: attempt.providerRef ?? null,
          providerMetadata: jsonInput(attempt.providerMetadata),
          nextAction: jsonInput(attempt.nextAction),
        },
      }),
    );
    return toPaymentTransaction(row);
  }

  async updateAttempt(
    scope: ReadScope,
    id: string,
    changes: PaymentTransactionChanges,
  ): Promise<PaymentTransaction> {
    const { providerMetadata, nextAction, ...plain } = changes;
    const row = await this.ctx.db.paymentTransaction.update({
      where: { id, ...scopeWhere(scope) },
      data: {
        ...definedOnly(plain),
        ...(providerMetadata !== undefined && {
          providerMetadata: jsonInput(providerMetadata),
        }),
        ...(nextAction !== undefined && { nextAction: jsonInput(nextAction) }),
      },
    });
    return toPaymentTransaction(row);
  }

  /**
   * Ids of `PENDING` Payments whose deadline is at or before `now`, earliest
   * deadline first, at most `limit`. Served by the partial expiry index.
   */
  async findExpiredPendingIds(
    scope: ReadScope,
    now: Date,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.ctx.db.$queryRaw<{ id: string }[]>(
      expiredPendingPaymentsQuery(scope, now, limit),
    );
    return rows.map((row) => row.id);
  }

  /**
   * Ids of attempts in `REQUIRES_REVIEW` for one of `reasons` whose review
   * opened after `openedAfter`, oldest review first.
   */
  async findReviewRequeryAttemptIds(
    scope: ReadScope,
    reasons: readonly ReviewReason[],
    openedAfter: Date,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.ctx.db.paymentTransaction.findMany({
      where: {
        ...scopeWhere(scope),
        status: 'REQUIRES_REVIEW',
        reviewReason: { in: [...reasons] },
        reviewOpenedAt: { gt: openedAfter },
      },
      orderBy: { reviewOpenedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** The id of the Payment an attempt belongs to, if the attempt exists. */
  async findPaymentIdByAttemptId(
    scope: ReadScope,
    attemptId: string,
  ): Promise<string | null> {
    const row = await this.ctx.db.paymentTransaction.findUnique({
      where: { id: attemptId, ...scopeWhere(scope) },
      select: { paymentId: true },
    });
    return row?.paymentId ?? null;
  }

  /** The id of the Organization's Payment with this Upstream Reference, if any. */
  async anyForPricingPlan(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<boolean> {
    const row = await this.ctx.db.payment.findFirst({
      where: { organizationId: scope.organizationId, pricingPlanId },
      select: { id: true },
    });
    return row !== null;
  }

  async findIdByUpstreamReference(
    scope: OrganizationScope,
    merchantOrderId: string,
  ): Promise<string | null> {
    const row = await this.ctx.db.payment.findUnique({
      where: {
        organizationId_merchantOrderId: {
          organizationId: scope.organizationId,
          merchantOrderId,
        },
      },
      select: { id: true },
    });
    return row?.id ?? null;
  }
}

/**
 * The expiry sweep's query. `'PENDING'` is a literal, not a parameter, so the
 * planner can match it to the partial index `core_payments_pending_expiry_idx`
 * (status, expires_at) WHERE status = 'PENDING'. Exported for the index test.
 *
 * Payments with an attempt in `REQUIRES_REVIEW` are left out: the expiry
 * worker never expires them (the attempt may hold money), so listing them
 * would fill the batch every minute and starve newer expired Payments. They
 * are found again once the review resolves.
 */
export function expiredPendingPaymentsQuery(
  scope: ReadScope,
  now: Date,
  limit: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT id FROM core_payments
    WHERE status = 'PENDING' AND expires_at <= ${now}
      AND ${scopeSql(scope, 'organization_id')}
      AND NOT EXISTS (
        SELECT 1 FROM core_payment_transactions t
        WHERE t.payment_id = core_payments.id AND t.status = 'REQUIRES_REVIEW')
    ORDER BY expires_at
    LIMIT ${limit}`;
}
