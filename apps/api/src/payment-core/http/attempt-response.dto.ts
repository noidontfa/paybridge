import { ApiProperty } from '@nestjs/swagger';
import type { PaymentTransaction } from '../domain/payment-transaction.js';
import { ATTEMPT_STATUSES, type AttemptStatus } from '../domain/statuses.js';
import type { NextAction } from '../port/index.js';
import type { StartAttemptResult } from '../application/use-cases/start-attempt.js';
import {
  PaymentResponseDto,
  toPaymentResponse,
} from './payment-response.dto.js';

/**
 * A PaymentTransaction (attempt) as `POST /payments/:id/attempts` returns it
 * (with the next action for the customer). `GET /payments/:id` uses the
 * different `AttemptDetailResponseDto`. Provider
 * metadata is internal and never returned.
 */
export class StartedAttemptResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The Attempt Key.' })
  id: string;

  @ApiProperty({ example: 'vnpay' })
  gatewayId: string;

  @ApiProperty({ enum: ATTEMPT_STATUSES })
  status: AttemptStatus;

  @ApiProperty({ type: String, nullable: true })
  providerRef: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'What the customer does next: { type: REDIRECT, url } | { type: QR_CODE, payload } | { type: CLIENT_SDK, token } | { type: VOUCHER, details }. Null unless the attempt is PENDING after the gateway accepted it.',
  })
  nextAction: NextAction | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

/** Response of `POST /payments/:id/attempts`. */
export class StartAttemptResponseDto {
  @ApiProperty({ type: StartedAttemptResponseDto })
  attempt: StartedAttemptResponseDto;

  @ApiProperty({ type: PaymentResponseDto })
  payment: PaymentResponseDto;
}

export function toStartedAttemptResponse(
  attempt: PaymentTransaction,
): StartedAttemptResponseDto {
  return {
    id: attempt.id,
    gatewayId: attempt.gatewayId,
    status: attempt.status,
    providerRef: attempt.providerRef,
    nextAction: attempt.nextAction,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

export function toStartAttemptResponse(
  result: StartAttemptResult,
): StartAttemptResponseDto {
  return {
    attempt: toStartedAttemptResponse(result.attempt),
    payment: toPaymentResponse(result.payment),
  };
}
