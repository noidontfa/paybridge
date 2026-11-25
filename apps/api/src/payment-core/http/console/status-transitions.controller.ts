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
import { ListStatusTransitions } from '../../application/use-cases/console/status-transitions.js';
import {
  type StatusTransitionsListQuery,
  statusTransitionsListQuerySchema,
} from './status-transitions.query.js';

/**
 * Operator endpoint (no authentication in Phase 1; keep `/internal` off the
 * public ingress). The response shape is the Console's `auditListSchema`.
 */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/status-transitions`)
export class StatusTransitionsController {
  constructor(
    @Inject(ListStatusTransitions)
    private readonly listTransitions: ListStatusTransitions,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List the audit log of status transitions, newest first (operator)',
    description:
      'Filters: entityType, entityId, trigger, actor, q (entity id, Payment id or Upstream Reference). Each row carries the paymentId it belongs to. Keyset paging with an opaque cursor; limit 1 to 100 (default 20).',
  })
  @ApiOkResponse({
    description:
      '`{ items, nextCursor }`; `nextCursor` is null on the last page',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async list(
    @CurrentScope() scope: OrganizationScope,
    @Query(new ZodValidationPipe(statusTransitionsListQuerySchema))
    query: StatusTransitionsListQuery,
  ) {
    const page = await this.listTransitions.execute(scope, query);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        trigger: row.trigger,
        actor: row.actor,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        paymentId: row.paymentId,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
