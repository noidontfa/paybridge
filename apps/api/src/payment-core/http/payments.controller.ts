import { Body, Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PaymentService } from '../application/payment.service.js';
import { PaymentResponseDto } from './payment-response.dto.js';
import {
  type CreatePaymentBody,
  CreatePaymentBodyDto,
  createPaymentSchema,
} from './schemas/create-payment.schema.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  idempotencyKeySchema,
} from './schemas/idempotency-key.schema.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a Payment for an upstream order' })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: false,
    description:
      'Up to 255 characters. A retry with the same key and body gets the stored response for 24 hours.',
  })
  @ApiBody({ type: CreatePaymentBodyDto })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The upstream reference already has a Payment; `details.paymentId` is its id',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'The Idempotency-Key was used with a different body',
  })
  async create(
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentBody,
    @Headers(IDEMPOTENCY_KEY_HEADER.toLowerCase()) rawKey: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(rawKey);
    const result = await this.payments.createPayment(body, { idempotencyKey });
    res.status(result.status);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }
}
