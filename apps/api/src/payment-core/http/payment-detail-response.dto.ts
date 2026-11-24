import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Payment } from '../domain/payment.js';
import type { PaymentTransaction } from '../domain/payment-transaction.js';
import {
  ATTEMPT_STATUSES,
  type AttemptStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
  REVIEW_REASONS,
  type ReviewReason,
} from '../domain/statuses.js';
import type { NextAction } from '../port/index.js';

/**
 * One attempt as `GET /payments/:id` returns it. Raw gateway responses,
 * provider metadata and the provider reference stay internal.
 */
export class AttemptResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The Attempt Key' })
  id: string;

  @ApiProperty({ example: 'fake' })
  gatewayId: string;

  @ApiProperty({ enum: ATTEMPT_STATUSES })
  status: AttemptStatus;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'What the customer must do next (REDIRECT, QR_CODE, CLIENT_SDK, ...), when present',
    example: { type: 'REDIRECT', url: 'https://gateway.example/pay/abc' },
  })
  nextAction?: NextAction;

  @ApiPropertyOptional({ enum: REVIEW_REASONS })
  reviewReason?: ReviewReason;

  @ApiPropertyOptional({ format: 'date-time' })
  reviewOpenedAt?: string;

  @ApiProperty()
  refundRequired: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

/** A Payment with all its attempts (oldest first), as `GET /payments/:id` returns it. */
export class PaymentDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'order-2026-0001' })
  upstreamReference: string;

  @ApiProperty({ example: '150000' })
  amount: string;

  @ApiProperty({ example: 'VND' })
  currency: string;

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: [AttemptResponseDto] })
  attempts: AttemptResponseDto[];
}

export function toAttemptResponse(
  attempt: PaymentTransaction,
): AttemptResponseDto {
  return {
    id: attempt.id,
    gatewayId: attempt.gatewayId,
    status: attempt.status,
    ...(attempt.nextAction && { nextAction: attempt.nextAction }),
    ...(attempt.reviewReason && { reviewReason: attempt.reviewReason }),
    ...(attempt.reviewOpenedAt && {
      reviewOpenedAt: attempt.reviewOpenedAt.toISOString(),
    }),
    refundRequired: attempt.refundRequired,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

export function toPaymentDetailResponse(
  payment: Payment,
): PaymentDetailResponseDto {
  return {
    id: payment.id,
    upstreamReference: payment.merchantOrderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    expiresAt: payment.expiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    attempts: payment.attempts.map(toAttemptResponse),
  };
}
