import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PaymentService } from '../application/payment.service.js';
import {
  StartAttemptResponseDto,
  toStartAttemptResponse,
} from './attempt-response.dto.js';
import {
  type StartAttemptBody,
  StartAttemptBodyDto,
  startAttemptSchema,
} from './schemas/start-attempt.schema.js';

@ApiTags('payments')
@Controller('payments/:paymentId/attempts')
export class AttemptsController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start an attempt on a Payment through the chosen gateway',
    description:
      'Returns the attempt with its next action (PENDING), or FAILED when the gateway rejects it; the customer may then start another attempt.',
  })
  @ApiBody({ type: StartAttemptBodyDto })
  @ApiCreatedResponse({ type: StartAttemptResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The Payment is not PENDING, has passed its expiry, has an open attempt, or has an attempt in review',
  })
  async start(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body(new ZodValidationPipe(startAttemptSchema)) body: StartAttemptBody,
  ): Promise<StartAttemptResponseDto> {
    const result = await this.payments.startAttempt({ paymentId, ...body });
    return toStartAttemptResponse(result);
  }
}
