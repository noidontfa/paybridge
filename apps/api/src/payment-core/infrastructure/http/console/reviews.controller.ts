import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import { CurrentReadScope } from '../current-scope.decorator.js';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { RequirePermission } from '../../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../../constants.js';
import { GetReviewSummary } from '../../../application/use-cases/console/get-review-summary.js';
import { ListReviews } from '../../../application/use-cases/console/list-reviews.js';
import {
  type ReviewsListQuery,
  reviewsListQuerySchema,
} from './reviews-list.query.js';

/**
 * Operator endpoints (no authentication in Phase 1; keep `/internal` off the
 * public ingress). The shapes are the Console's `reviewListSchema` and
 * `reviewSummarySchema`.
 */
@ApiTags('internal')
@RequirePermission('payments:view')
@Controller(`${INTERNAL_PREFIX}/reviews`)
export class ReviewsController {
  constructor(
    @Inject(ListReviews) private readonly listReviews: ListReviews,
    @Inject(GetReviewSummary)
    private readonly getReviewSummary: GetReviewSummary,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List Reviews: PaymentTransactions with a review reason (operator)',
    description:
      'Filters: reason, gatewayId, state (open, the default, or closed), q (Payment id, Attempt Key or Upstream Reference). Sorted by the time the Review opened, oldest first unless order=desc. Keyset paging with an opaque cursor; limit 1 to 100 (default 20).',
  })
  @ApiOkResponse({
    description:
      '`{ items, nextCursor }`; `nextCursor` is null on the last page',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async list(
    @CurrentReadScope() scope: ReadScope,
    @Query(new ZodValidationPipe(reviewsListQuerySchema))
    query: ReviewsListQuery,
  ) {
    const page = await this.listReviews.execute(scope, query);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        reason: row.reason,
        state: row.state,
        gatewayId: row.gatewayId,
        transactionStatus: row.transactionStatus,
        refundRequired: row.refundRequired,
        reviewOpenedAt: row.reviewOpenedAt.toISOString(),
        resolvableAt: row.resolvableAt.toISOString(),
        providerReportedAmount: row.providerReportedAmount,
        payment: row.payment,
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Review counts: open, total and open by reason (operator)',
  })
  @ApiOkResponse({ description: '`{ open, total, byReason }`' })
  summary(@CurrentReadScope() scope: ReadScope) {
    return this.getReviewSummary.execute(scope);
  }
}
