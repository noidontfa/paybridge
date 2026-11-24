import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PaymentService } from '../application/payment.service.js';
import {
  PaymentResponseDto,
  toPaymentResponse,
} from './payment-response.dto.js';
import {
  type CreatePaymentBody,
  CreatePaymentBodyDto,
  createPaymentSchema,
} from './schemas/create-payment.schema.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a Payment for an upstream order' })
  @ApiBody({ type: CreatePaymentBodyDto })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The upstream reference already has a Payment',
  })
  async create(
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentBody,
  ): Promise<PaymentResponseDto> {
    const payment = await this.payments.createPayment(body);
    return toPaymentResponse(payment);
  }
}
