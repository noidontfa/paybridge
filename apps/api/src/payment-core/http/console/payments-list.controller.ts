import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentScope } from '../current-scope.decorator.js';
import type { OrganizationScope } from '../../domain/organization-scope.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import { ListPayments } from '../../application/use-cases/console/list-payments.js';
import {
  type PaymentsListQuery,
  paymentsListQuerySchema,
} from './payments-list.query.js';

/**
 * Operator endpoint (no authentication in Phase 1; keep `/internal` off the
 * public ingress). The response shape is the Console's `paymentListSchema`.
 */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/payments`)
export class PaymentsListController {
  constructor(
    @Inject(ListPayments) private readonly listPayments: ListPayments,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List Payments with their latest attempt (operator)',
    description:
      'Filters: status, gatewayId (any attempt), q (Payment id or Upstream Reference), createdFrom, createdTo (YYYY-MM-DD, UTC). Sort: createdAt or amount, asc or desc. Keyset paging with an opaque cursor; limit 1 to 100 (default 20).',
  })
  @ApiOkResponse({
    description:
      '`{ items, nextCursor }`; `nextCursor` is null on the last page',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async list(
    @CurrentScope() scope: OrganizationScope,
    @Query(new ZodValidationPipe(paymentsListQuerySchema))
    query: PaymentsListQuery,
  ) {
    const page = await this.listPayments.execute(scope, query);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        upstreamReference: row.upstreamReference,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        latestTransaction: row.latestTransaction,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
