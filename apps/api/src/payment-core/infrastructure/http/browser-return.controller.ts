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
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { Public } from '../../../identity/http/principal.guard.js';
import { PaymentService } from '../../application/payment.service.js';
import { ALL_ORGANIZATIONS } from '../../domain/organization-scope.js';
import {
  PaymentDetailResponseDto,
  toPaymentDetailResponse,
} from './payment-detail-response.dto.js';

/**
 * The customer's browser carries no API Key, so the route is `@Public()`. The
 * Payment id (an unguessable UUID) names the Payment, which is looked up
 * across Organizations: it belongs to its own Organization whatever that is
 * (ADR 0006). Nothing is written, and the response is that one Payment.
 */
@ApiTags('payments')
@Public()
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
    const payment = await this.payments.handleBrowserReturn(ALL_ORGANIZATIONS, {
      paymentId,
      attemptId: wanted,
    });
    return toPaymentDetailResponse(payment);
  }
}
