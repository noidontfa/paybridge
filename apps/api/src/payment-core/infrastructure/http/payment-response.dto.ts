import { ApiProperty } from '@nestjs/swagger';
import type { PaymentSnapshot } from '../../application/use-cases/create-payment.js';
import type { Payment } from '../../domain/entities/payment.js';
import { PAYMENT_STATUSES, type PaymentStatus } from '../../domain/statuses.js';

/** A Payment as the HTTP API returns it. */
export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({ example: '150000' })
  amount: string;

  @ApiProperty({ example: 'VND' })
  currency: string;

  @ApiProperty({ example: 'order-2026-0001' })
  upstreamReference: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

/** Maps a stored create-time snapshot (idempotent replay) to the response. */
export function snapshotToPaymentResponse(
  snapshot: PaymentSnapshot,
): PaymentResponseDto {
  return { ...snapshot, status: snapshot.status as PaymentStatus };
}

export function toPaymentResponse(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    upstreamReference: payment.merchantOrderId,
    expiresAt: payment.expiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
  };
}
