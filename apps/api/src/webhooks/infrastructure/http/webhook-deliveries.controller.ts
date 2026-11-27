import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../../common/principal/access-policy.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  optionalParam,
  pagingShape,
} from '../../../payment-core/port/console-lists.js';
import type { ReadScope } from '../../../payment-core/port/organization-scope.js';
import {
  ReadWebhookDeliveries,
  SendWebhooksByHand,
  webhookDeliveriesCursor,
  WebhookDeliveryBusyError,
  WebhookDeliveryNotFoundError,
} from '../../application/use-cases/webhook-deliveries.js';
import { DELIVERY_KINDS } from '../../domain/entities/test-event.js';
import { actorLabel } from '../../domain/entities/webhook-endpoint.js';
import type {
  WebhookDeliveryDetailRow,
  WebhookDeliveryListRow,
} from '../../domain/repositories/webhook-deliveries-read.repository.js';
import { callerOf, readScopeOf } from './caller.js';

const listQuerySchema = z
  .object({
    ...pagingShape,
    endpointId: optionalParam(z.uuid()),
    status: optionalParam(z.enum(['PENDING', 'SUCCEEDED', 'FAILED'])),
    kind: optionalParam(z.enum(DELIVERY_KINDS)),
    paymentId: optionalParam(z.uuid()),
  })
  .transform((query, ctx) => {
    const after = webhookDeliveriesCursor.parse(ctx, query.cursor);
    if (after === null) return z.NEVER;
    return {
      limit: query.limit,
      after,
      filters: {
        endpointId: query.endpointId,
        status: query.status,
        kind: query.kind,
        paymentId: query.paymentId,
      },
    };
  });
type ListQuery = z.output<typeof listQuerySchema>;

/** The Console's `webhookDeliveryListItemSchema`. */
export const listItemView = (row: WebhookDeliveryListRow) => ({
  id: row.id,
  endpoint: row.endpoint,
  eventId: row.eventId,
  eventKind: row.eventKind,
  paymentId: row.paymentId,
  status: row.status,
  attempts: row.attempts,
  lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
  lastHttpStatus: row.lastHttpStatus,
  createdAt: row.createdAt.toISOString(),
});

/** The Console's `webhookDeliveryDetailSchema`. */
export const detailView = (row: WebhookDeliveryDetailRow) => ({
  ...listItemView(row),
  eventCreatedAt: row.eventCreatedAt.toISOString(),
  history: row.history.map((attempt) => ({
    id: attempt.id,
    attemptedAt: attempt.attemptedAt.toISOString(),
    succeeded: attempt.succeeded,
    httpStatus: attempt.httpStatus,
    durationMs: attempt.durationMs,
    responseBody: attempt.responseBody,
    error: attempt.error,
    triggeredBy: attempt.triggeredBy && {
      name: attempt.triggeredBy.name,
      role: attempt.triggeredBy.role,
      label: actorLabel(attempt.triggeredBy),
    },
  })),
});

export function mapDeliveryError(error: unknown): never {
  if (error instanceof WebhookDeliveryNotFoundError) {
    throw new NotFoundException({
      message: error.message,
      code: 'WEBHOOK_DELIVERY_NOT_FOUND',
    });
  }
  if (error instanceof WebhookDeliveryBusyError) {
    throw new ConflictException({
      message: error.message,
      code: 'WEBHOOK_DELIVERY_BUSY',
    });
  }
  throw error;
}

/**
 * Each Payment Event delivered (or tried) to the Organization's Webhook
 * Endpoints, for Operators and Admins. A resend is a sensitive write
 * (ADR 0008) recorded with the User on the new attempt.
 */
@ApiTags('internal')
@RequirePermission('webhook-deliveries:view')
@Controller(`${INTERNAL_PREFIX}/webhook-deliveries`)
export class WebhookDeliveriesController {
  constructor(
    @Inject(ReadWebhookDeliveries)
    private readonly deliveries: ReadWebhookDeliveries,
    @Inject(SendWebhooksByHand) private readonly send: SendWebhooksByHand,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List Webhook deliveries, newest first',
    description:
      'Filters: endpointId, status, kind, paymentId. Keyset paging with an opaque cursor; limit 1 to 100 (default 20).',
  })
  async list(
    @Req() request: Record<string, unknown>,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    const page = await this.deliveries.list(readScopeOf(request), query);
    return { items: page.items.map(listItemView), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One Webhook delivery with every attempt' })
  async get(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.detail(readScopeOf(request), id);
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('webhook-deliveries:resend')
  @ApiOperation({
    summary:
      'Send a delivery again now: a new attempt with the same event id, recorded with the User',
  })
  async resend(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { scope, actor } = callerOf(request);
    try {
      await this.send.resend(scope, id, actor);
    } catch (error) {
      mapDeliveryError(error);
    }
    return this.detail(scope, id);
  }

  private async detail(scope: ReadScope, id: string) {
    try {
      return detailView(await this.deliveries.get(scope, id));
    } catch (error) {
      mapDeliveryError(error);
    }
  }
}
