import { ApiProperty } from '@nestjs/swagger';
import type { Payment } from '../domain/payment.js';
import { PAYMENT_STATUSES, type PaymentStatus } from '../domain/statuses.js';

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
