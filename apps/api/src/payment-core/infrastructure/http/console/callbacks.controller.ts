import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import { CurrentReadScope } from '../current-scope.decorator.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import { RequirePermission } from '../../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../../constants.js';
import {
  GetCallback,
  ListCallbacks,
} from '../../../application/use-cases/console/callbacks.js';
import {
  type CallbacksListQuery,
  callbacksListQuerySchema,
} from './callbacks.query.js';

/**
 * Operator endpoints (no authentication in Phase 1; keep `/internal` off the
 * public ingress). Response shapes are the Console's `callbackListSchema` and
 * `callbackDetailSchema`. A Callback is a stored inbound gateway notification.
 */
@ApiTags('internal')
@RequirePermission('payments:view')
@Controller(`${INTERNAL_PREFIX}/callbacks`)
export class CallbacksController {
  constructor(
    @Inject(ListCallbacks) private readonly listCallbacks: ListCallbacks,
    @Inject(GetCallback) private readonly getCallback: GetCallback,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List Callbacks, newest first (operator)',
    description:
      'Filters: gatewayId, status, q (Callback id, Provider Event id, Attempt Key, Payment id or Upstream Reference). Keyset paging with an opaque cursor; limit 1 to 100 (default 20).',
  })
  @ApiOkResponse({
    description:
      '`{ items, nextCursor }`; `nextCursor` is null on the last page',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async list(
    @CurrentReadScope() scope: ReadScope,
    @Query(new ZodValidationPipe(callbacksListQuerySchema))
    query: CallbacksListQuery,
  ) {
    const page = await this.listCallbacks.execute(scope, query);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        gatewayId: row.gatewayId,
        providerEventId: row.providerEventId,
        attemptKey: row.attemptKey,
        status: row.status,
        attempts: row.attempts,
        receivedAt: row.receivedAt.toISOString(),
        processedAt: row.processedAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One Callback with headers, query, raw body and last error (operator)',
  })
  @ApiOkResponse({ description: 'The Callback' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async get(@CurrentReadScope() scope: ReadScope, @Param('id') id: string) {
    const row = await this.getCallback.execute(scope, id);
    if (!row) throw new NotFoundException(`Callback ${id} not found`);
    return {
      id: row.id,
      gatewayId: row.gatewayId,
      providerEventId: row.providerEventId,
      attemptKey: row.attemptKey,
      status: row.status,
      attempts: row.attempts,
      receivedAt: row.receivedAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
      headers: row.headers,
      query: row.query,
      rawBody: row.rawBody,
      lastError: row.lastError,
      paymentId: row.paymentId,
    };
  }
}
