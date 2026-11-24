import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { validate as isUuid } from 'uuid';
import { ErrorResponseDto } from '../../common/filters/error-response.dto.js';
import { PaymentService } from '../application/payment.service.js';
import {
  PaymentDetailResponseDto,
  toPaymentDetailResponse,
} from './payment-detail-response.dto.js';

@ApiTags('payments')
@Controller('payments/:paymentId/return')
export class BrowserReturnController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Landing route for the customer returning from a gateway',
    description:
      'Shows the stored Payment, which may still be PENDING, and queues a status query for the attempt. Nothing the provider put in the request is trusted, and nothing is written.',
  })
  @ApiQuery({ name: 'attemptId', required: false })
  @ApiOkResponse({ type: PaymentDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async handle(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Query('attemptId') attemptId?: unknown,
  ): Promise<PaymentDetailResponseDto> {
    // Provider parameters ride along on this URL; only a valid attempt id is used.
    const wanted =
      typeof attemptId === 'string' && isUuid(attemptId)
        ? attemptId
        : undefined;
    const payment = await this.payments.handleBrowserReturn({
      paymentId,
      attemptId: wanted,
    });
    return toPaymentDetailResponse(payment);
  }
}
