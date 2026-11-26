import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../../common/filters/error-response.dto.js';
import { CurrentReadScope } from '../current-scope.decorator.js';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { RequirePermission } from '../../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../../constants.js';
import {
  GatewaysOverview,
  type GatewayDetail,
  type GatewaySummary,
} from '../../../application/use-cases/console/gateways.js';

/**
 * Operator endpoints (no authentication in Phase 1). The response shapes are
 * the Console's `gatewayListSchema` and `gatewayDetailSchema`.
 */
@ApiTags('internal')
@RequirePermission('payments:view')
@Controller(`${INTERNAL_PREFIX}/gateways`)
export class GatewaysController {
  constructor(
    @Inject(GatewaysOverview) private readonly gateways: GatewaysOverview,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List PaymentGateways and their Callback URLs (operator)',
  })
  @ApiOkResponse({ description: '`{ items }`; never contains a credential' })
  async list(
    @CurrentReadScope() scope: ReadScope,
  ): Promise<{ items: GatewaySummary[] }> {
    return { items: await this.gateways.list(scope) };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One PaymentGateway with Callback health over the last 24 hours (operator)',
  })
  @ApiOkResponse({ description: 'Summary plus Callback counts by status' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async get(
    @CurrentReadScope() scope: ReadScope,
    @Param('id') id: string,
  ): Promise<GatewayDetail> {
    const detail = await this.gateways.detail(scope, id);
    if (!detail) {
      throw new NotFoundException({
        message: `Unknown gateway "${id}"`,
        code: 'GATEWAY_NOT_FOUND',
      });
    }
    return detail;
  }
}
