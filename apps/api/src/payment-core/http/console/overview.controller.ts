import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentReadScope } from '../current-scope.decorator.js';
import type { ReadScope } from '../../domain/organization-scope.js';
import { RequirePermission } from '../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  GetOverview,
  successRate,
} from '../../application/use-cases/console/get-overview.js';
import { type OverviewQuery, overviewQuerySchema } from './overview.query.js';

/**
 * Operator endpoint (no authentication in Phase 1). The response shape is
 * the Console's `overviewSchema`.
 */
@ApiTags('internal')
@RequirePermission('payments:view')
@Controller(`${INTERNAL_PREFIX}/overview`)
export class OverviewController {
  constructor(@Inject(GetOverview) private readonly getOverview: GetOverview) {}

  @Get()
  @ApiOperation({
    summary: 'Overview figures for a rolling range (operator)',
    description:
      'range: 24h (24 hourly buckets), 7d or 30d (24-hour buckets), counted back from now.',
  })
  @ApiOkResponse({ description: 'The Console overview shape' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async overview(
    @CurrentReadScope() scope: ReadScope,
    @Query(new ZodValidationPipe(overviewQuerySchema)) query: OverviewQuery,
  ) {
    const view = await this.getOverview.execute(scope, query.range);
    const { data } = view;
    return {
      range: view.range,
      from: view.from.toISOString(),
      to: view.to.toISOString(),
      currency: data.currency,
      volume: data.volume,
      paymentCount: data.paymentCount,
      successRate: view.successRate,
      openReviewCount: data.openReviewCount,
      volumeSeries: view.bucketStarts.map((start, i) => ({
        start: start.toISOString(),
        volume: data.volumeSeries[i],
      })),
      statusCounts: data.statusCounts,
      gateways: data.gateways.map((g) => ({
        gatewayId: g.gatewayId,
        count: g.count,
        volume: g.volume,
        successRate: successRate(g.succeeded, g.closed),
      })),
      recentPayments: data.recent.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }
}
