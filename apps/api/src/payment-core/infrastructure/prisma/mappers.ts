import { Prisma } from '../../../generated/prisma/client.js';
import type {
  Payment as PaymentRow,
  PaymentTransaction as PaymentTransactionRow,
} from '../../../generated/prisma/client.js';
import type * as DbEnums from '../../../generated/prisma/enums.js';
import type { Payment } from '../../domain/payment.js';
import type { PaymentTransaction } from '../../domain/payment-transaction.js';
import type {
  AttemptStatus,
  PaymentStatus,
  ReviewReason,
} from '../../domain/statuses.js';
import type { NextAction, ProviderMetadata } from '../../port/index.js';

// Prisma row <-> domain object. Repositories call these so that nothing
// returned to a use case carries a Prisma type (Decimal, JsonValue, ...).

// Compile-time guard: the domain unions and the database enums are the same
// sets. Each type is `true` only if both directions are assignable.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const enumsMatch: [
  Same<PaymentStatus, DbEnums.PaymentStatus>,
  Same<AttemptStatus, DbEnums.PaymentTransactionStatus>,
  Same<ReviewReason, DbEnums.ReviewReason>,
] = [true, true, true];
void enumsMatch;

/** Exact decimal string, never in exponent form, no trailing zeros. */
export function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed();
}

export function toDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** JSON column input: SQL NULL for null, the value otherwise. */
export function jsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

/** Drops keys whose value is `undefined`, so a patch only sets what it names. */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export function toPaymentTransaction(
  row: PaymentTransactionRow,
): PaymentTransaction {
  return {
    id: row.id,
    paymentId: row.paymentId,
    gatewayId: row.gatewayId,
    status: row.status,
    providerRef: row.providerRef,
    providerMetadata: row.providerMetadata as ProviderMetadata | null,
    nextAction: row.nextAction as NextAction | null,
    reviewReason: row.reviewReason,
    reviewOpenedAt: row.reviewOpenedAt,
    refundRequired: row.refundRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPayment(
  row: PaymentRow,
  attempts: readonly PaymentTransactionRow[],
): Payment {
  return {
    id: row.id,
    merchantOrderId: row.merchantOrderId,
    amount: decimalToString(row.amount),
    currency: row.currency,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attempts: attempts.map(toPaymentTransaction),
  };
}
