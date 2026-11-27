import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireSensitivePermission } from '../../../common/principal/access-policy.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import { ReadWebhookDeliveries } from '../../application/use-cases/webhook-deliveries.js';
import { ManageWebhookEndpoints } from '../../application/use-cases/webhook-endpoints.js';
import { PAYMENT_EVENT_KINDS } from '../../domain/entities/event-kinds.js';
import { actorLabel } from '../../../common/principal/actor.js';
import {
  InvalidWebhookUrlError,
  SECRET_OVERLAPS,
  WebhookEndpointNotFoundError,
  type SecretOverlap,
  type WebhookEndpoint,
} from '../../domain/entities/webhook-endpoint.js';
import { callerOf } from '../../../common/principal/caller.js';

const url = z.string().trim().min(1).max(2048);
const eventKinds = z.array(z.enum(PAYMENT_EVENT_KINDS)).min(1).max(20);
const createSchema = z.object({ url, eventKinds });
const updateSchema = z
  .object({ url: url.optional(), eventKinds: eventKinds.optional() })
  .refine((b) => b.url !== undefined || b.eventKinds !== undefined, {
    message: 'Change the URL, the event kinds, or both',
  });
const rollSchema = z.object({
  previousSecretValidFor: z.enum(
    Object.keys(SECRET_OVERLAPS) as [SecretOverlap, ...SecretOverlap[]],
  ),
});
type CreateBody = z.output<typeof createSchema>;
type RollBody = z.output<typeof rollSchema>;
type UpdateBody = z.output<typeof updateSchema>;

/** What the Console sees of an endpoint: never the secret, only its prefix. */
const view = (endpoint: WebhookEndpoint) => ({
  id: endpoint.id,
  url: endpoint.url,
  eventKinds: endpoint.eventKinds,
  status: endpoint.status,
  secretPrefix: endpoint.secretPrefix,
  /** While set, Webhooks are signed with the previous secret too. */
  previousSecretExpiresAt:
    endpoint.previousSecret?.expiresAt.toISOString() ?? null,
  createdAt: endpoint.createdAt.toISOString(),
  updatedAt: endpoint.updatedAt.toISOString(),
  updatedBy: {
    name: endpoint.updatedBy.name,
    role: endpoint.updatedBy.role,
    label: actorLabel(endpoint.updatedBy),
  },
});

function mapError(error: unknown): never {
  if (error instanceof WebhookEndpointNotFoundError) {
    throw new NotFoundException({
      message: error.message,
      code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
    });
  }
  if (error instanceof InvalidWebhookUrlError) {
    throw new BadRequestException({
      message: error.message,
      code: 'INVALID_WEBHOOK_URL',
    });
  }
  throw error;
}

/**
 * Webhook Endpoint management. Every route is a sensitive write or gated like
 * one: the caller is re-checked in the database (ADR 0008), and an Operator
 * is refused. Edits are POSTs, as the Console's BFF forwards no PUT or PATCH.
 */
@ApiTags('internal')
@RequireSensitivePermission('webhook-endpoints:manage')
@Controller(`${INTERNAL_PREFIX}/webhook-endpoints`)
export class WebhookEndpointsController {
  constructor(
    @Inject(ManageWebhookEndpoints)
    private readonly endpoints: ManageWebhookEndpoints,
    @Inject(ReadWebhookDeliveries)
    private readonly deliveries: ReadWebhookDeliveries,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Register a Webhook Endpoint; the signing secret is returned only in this response',
  })
  async create(
    @Req() request: Record<string, unknown>,
    @Body(new ZodValidationPipe(createSchema)) body: CreateBody,
  ) {
    const { scope, actor } = callerOf(request);
    try {
      const { endpoint, secret } = await this.endpoints.create(
        scope,
        body,
        actor,
      );
      return { ...view(endpoint), secret };
    } catch (error) {
      mapError(error);
    }
  }

  @Get()
  @ApiOperation({
    summary:
      "List the Organization's Webhook Endpoints (never the secret), each marked failing when its latest attempts all failed",
  })
  async list(@Req() request: Record<string, unknown>) {
    const { scope } = callerOf(request);
    const items = await this.endpoints.list(scope);
    const failing = await this.deliveries.failingEndpoints(
      scope,
      items.map((e) => e.id),
    );
    return {
      items: items.map((e) => ({ ...view(e), failing: failing.has(e.id) })),
    };
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the URL or the event kinds of an endpoint' })
  async update(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateBody,
  ) {
    const { scope, actor } = callerOf(request);
    try {
      return view(await this.endpoints.update(scope, id, body, actor));
    } catch (error) {
      mapError(error);
    }
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop delivering to an endpoint' })
  disable(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.setStatus(request, id, 'DISABLED');
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deliver to an endpoint again' })
  enable(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.setStatus(request, id, 'ENABLED');
  }

  @Post(':id/roll-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace the signing secret, keeping the old one valid for a while; the new secret is returned only in this response',
  })
  async rollSecret(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(rollSchema)) body: RollBody,
  ) {
    const { scope, actor } = callerOf(request);
    try {
      const { endpoint, secret } = await this.endpoints.rollSecret(
        scope,
        id,
        body.previousSecretValidFor,
        actor,
      );
      return { ...view(endpoint), secret };
    } catch (error) {
      mapError(error);
    }
  }

  @Get(':id/secret-rolls')
  @ApiOperation({
    summary: "Audit log of an endpoint's secret rolls, newest first",
  })
  async secretRolls(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      const rolls = await this.endpoints.secretRolls(
        callerOf(request).scope,
        id,
      );
      return {
        items: rolls.map((roll) => ({
          rolledAt: roll.rolledAt.toISOString(),
          previousSecretExpiresAt:
            roll.previousSecretExpiresAt?.toISOString() ?? null,
          rolledBy: {
            name: roll.rolledBy.name,
            role: roll.rolledBy.role,
            label: actorLabel(roll.rolledBy),
          },
        })),
      };
    } catch (error) {
      mapError(error);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an endpoint; it gets no more deliveries' })
  async remove(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const { scope, actor } = callerOf(request);
    try {
      await this.endpoints.delete(scope, id, actor);
    } catch (error) {
      mapError(error);
    }
  }

  private async setStatus(
    request: Record<string, unknown>,
    id: string,
    status: 'ENABLED' | 'DISABLED',
  ) {
    const { scope, actor } = callerOf(request);
    try {
      return view(await this.endpoints.setStatus(scope, id, status, actor));
    } catch (error) {
      mapError(error);
    }
  }
}
