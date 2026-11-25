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
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { CurrentScope } from '../current-scope.decorator.js';
import type { OrganizationScope } from '../../domain/organization-scope.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  GatewaysOverview,
  type GatewayDetail,
  type GatewaySummary,
} from '../../application/use-cases/console/gateways.js';

/**
 * Operator endpoints (no authentication in Phase 1). The response shapes are
 * the Console's `gatewayListSchema` and `gatewayDetailSchema`.
 */
@ApiTags('internal')
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
    @CurrentScope() scope: OrganizationScope,
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
    @CurrentScope() scope: OrganizationScope,
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
