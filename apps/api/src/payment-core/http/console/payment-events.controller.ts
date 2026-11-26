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
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentReadScope } from '../current-scope.decorator.js';
import type { ReadScope } from '../../domain/organization-scope.js';
import { RequirePermission } from '../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  GetPaymentEvent,
  ListPaymentEvents,
} from '../../application/use-cases/console/payment-events.js';
import {
  type PaymentEventsListQuery,
  paymentEventsListQuerySchema,
} from './payment-events.query.js';

/**
 * Operator endpoints (no authentication in Phase 1; keep `/internal` off the
 * public ingress). Response shapes are the Console's `paymentEventListSchema`
 * (no payload) and `paymentEventSchema` (with payload).
 */
@ApiTags('internal')
@RequirePermission('payments:view')
@Controller(`${INTERNAL_PREFIX}/payment-events`)
export class PaymentEventsController {
  constructor(
    @Inject(ListPaymentEvents) private readonly listEvents: ListPaymentEvents,
    @Inject(GetPaymentEvent) private readonly getEvent: GetPaymentEvent,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List Payment Events without payload, newest first (operator)',
    description:
      'Filters: type, published (true or false), q (event id, Payment id or Upstream Reference). Keyset paging with an opaque cursor; limit 1 to 100 (default 20).',
  })
  @ApiOkResponse({
    description:
      '`{ items, nextCursor }`; `nextCursor` is null on the last page',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async list(
    @CurrentReadScope() scope: ReadScope,
    @Query(new ZodValidationPipe(paymentEventsListQuerySchema))
    query: PaymentEventsListQuery,
  ) {
    const page = await this.listEvents.execute(scope, query);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        type: row.type,
        paymentId: row.paymentId,
        createdAt: row.createdAt.toISOString(),
        publishedAt: row.publishedAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One Payment Event with its payload (operator)' })
  @ApiOkResponse({ description: 'The Payment Event' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async get(@CurrentReadScope() scope: ReadScope, @Param('id') id: string) {
    const row = await this.getEvent.execute(scope, id);
    if (!row) throw new NotFoundException(`Payment Event ${id} not found`);
    return {
      id: row.id,
      type: row.type,
      paymentId: row.paymentId,
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    };
  }
}
