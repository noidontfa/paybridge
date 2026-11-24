import type {
  NewPayment,
  Payment,
  PaymentChanges,
} from '../../domain/payment.js';
import type {
  NewPaymentTransaction,
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../../domain/payment-transaction.js';
import type { DbContext } from './db.js';
import {
  definedOnly,
  jsonInput,
  toDecimal,
  toPayment,
  toPaymentTransaction,
} from './mappers.js';

const ATTEMPTS_OLDEST_FIRST = {
  orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
};

/** The Payment aggregate: a Payment plus its attempts. No Refunds in Phase 1. */
export class PrismaPaymentRepository {
  constructor(private readonly ctx: DbContext) {}

  async findById(id: string): Promise<Payment | null> {
    const row = await this.ctx.db.payment.findUnique({
      where: { id },
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
  async findForUpdate(id: string): Promise<Payment | null> {
    if (!this.ctx.inTransaction) {
      throw new Error(
        'findForUpdate must run inside TransactionRunner.run: a lock outside a transaction is released at once',
      );
    }
    const locked = await this.ctx.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM core_payments WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    return this.findById(id);
  }

  async create(payment: NewPayment): Promise<Payment> {
    const row = await this.ctx.db.payment.create({
      data: {
        id: payment.id,
        merchantOrderId: payment.merchantOrderId,
        amount: toDecimal(payment.amount),
        currency: payment.currency,
        status: payment.status,
        expiresAt: payment.expiresAt,
      },
    });
    return toPayment(row, []);
  }

  async update(id: string, changes: PaymentChanges): Promise<Payment> {
    const row = await this.ctx.db.payment.update({
      where: { id },
      data: definedOnly(changes),
      include: { transactions: ATTEMPTS_OLDEST_FIRST },
    });
    return toPayment(row, row.transactions);
  }

  async createAttempt(
    attempt: NewPaymentTransaction,
  ): Promise<PaymentTransaction> {
    const row = await this.ctx.db.paymentTransaction.create({
      data: {
        id: attempt.id,
        paymentId: attempt.paymentId,
        gatewayId: attempt.gatewayId,
        status: attempt.status,
        providerRef: attempt.providerRef ?? null,
        providerMetadata: jsonInput(attempt.providerMetadata),
        nextAction: jsonInput(attempt.nextAction),
      },
    });
    return toPaymentTransaction(row);
  }

  async updateAttempt(
    id: string,
    changes: PaymentTransactionChanges,
  ): Promise<PaymentTransaction> {
    const { providerMetadata, nextAction, ...plain } = changes;
    const row = await this.ctx.db.paymentTransaction.update({
      where: { id },
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

  /** The id of the Payment with this Upstream Reference, if any. */
  async findIdByUpstreamReference(
    merchantOrderId: string,
  ): Promise<string | null> {
    const row = await this.ctx.db.payment.findUnique({
      where: { merchantOrderId },
      select: { id: true },
    });
    return row?.id ?? null;
  }
}
