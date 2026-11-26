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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireSensitivePermission } from '../../../common/principal/access-policy.js';
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import { PaymentService } from '../../application/payment.service.js';
import type { OrganizationScope } from '../../domain/value-objects/organization-scope.js';
import {
  CurrentActor,
  CurrentScope,
  type Actor,
} from './current-scope.decorator.js';
import {
  PaymentDetailResponseDto,
  toPaymentDetailResponse,
} from './payment-detail-response.dto.js';
import {
  type ReviewResolutionBody,
  ReviewResolutionBodyDto,
  reviewResolutionSchema,
} from './schemas/review-resolution.schema.js';

/**
 * Operator endpoint. It lives under `/internal` (outside the public `/api`
 * prefix) and needs a signed-in User: the actor and their Role come from the
 * access token, never from the body.
 */
@ApiTags('internal')
@RequireSensitivePermission('reviews:resolve')
@Controller(`${INTERNAL_PREFIX}/payments/:paymentId/review-resolution`)
export class ReviewResolutionController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve, or add a note to, a review on one attempt (operator)',
    description:
      'Setting a status needs a review open for at least 72 hours. LATE_SUCCESS_ON_CLOSED_PAYMENT and DUPLICATE_SUCCESS accept notes only. Internal: not for public exposure.',
  })
  @ApiBody({ type: ReviewResolutionBodyDto })
  @ApiOkResponse({ type: PaymentDetailResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The attempt is not in review, the review is younger than 72 hours, or the rules forbid the requested status',
  })
  async resolve(
    @CurrentScope() scope: OrganizationScope,
    @CurrentActor() actor: Actor,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body(new ZodValidationPipe(reviewResolutionSchema))
    body: ReviewResolutionBody,
  ): Promise<PaymentDetailResponseDto> {
    const payment = await this.payments.resolveReview(scope, {
      paymentId,
      ...body,
      actor: actor.userId,
      actorRole: actor.role,
      actorName: actor.name,
    });
    return toPaymentDetailResponse(payment);
  }
}
