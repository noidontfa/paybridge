import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { RequireSensitivePermission } from '../../common/principal/access-policy.js';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../common/principal/principal.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../constants.js';
import {
  CreateApiKey,
  ListApiKeys,
  RevokeApiKey,
} from '../application/use-cases/api-keys.js';
import {
  ApiKeyNotFoundError,
  InvalidApiKeyLabelError,
  type ApiKey,
} from '../domain/api-key.js';

const createSchema = z.object({ label: z.string().max(1000) });
type CreateBody = z.output<typeof createSchema>;

const view = (key: ApiKey) => ({
  id: key.id,
  label: key.label,
  prefix: key.prefix,
  createdAt: key.createdAt,
  lastUsedAt: key.lastUsedAt,
  revokedAt: key.revokedAt,
});

/** The Organization the caller works in: one is always required. */
function organizationOf(request: Record<string, unknown>): string {
  const principal = request[PRINCIPAL_REQUEST_KEY] as Principal;
  if (!principal.organizationId) {
    throw new ForbiddenException({
      message: 'Choose one Organization to work in',
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  return principal.organizationId;
}

/**
 * API Key management. Creating and revoking are sensitive writes: the
 * caller is re-checked in the database (ADR 0008). Listing is a read, but it
 * is gated by the same Permission, so an Operator cannot even see the keys.
 */
@ApiTags('internal')
@RequireSensitivePermission('api-keys:manage')
@Controller(`${INTERNAL_PREFIX}/api-keys`)
export class ApiKeysController {
  constructor(
    @Inject(CreateApiKey) private readonly createKey: CreateApiKey,
    @Inject(ListApiKeys) private readonly listKeys: ListApiKeys,
    @Inject(RevokeApiKey) private readonly revokeKey: RevokeApiKey,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create an API Key; the full key is returned only in this response',
  })
  async create(
    @Req() request: Record<string, unknown>,
    @Body(new ZodValidationPipe(createSchema)) body: CreateBody,
  ) {
    const organizationId = organizationOf(request);
    try {
      const { apiKey, key } = await this.createKey.execute(
        organizationId,
        body.label,
      );
      return { ...view(apiKey), key };
    } catch (error) {
      if (error instanceof InvalidApiKeyLabelError) {
        throw new BadRequestException({
          message: error.message,
          code: 'INVALID_API_KEY_LABEL',
        });
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: "List the Organization's API Keys (never the key)" })
  async list(@Req() request: Record<string, unknown>) {
    const items = await this.listKeys.execute(organizationOf(request));
    return { items: items.map(view) };
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an API Key; it fails on its next request' })
  async revoke(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      await this.revokeKey.execute(organizationOf(request), id);
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError) {
        throw new NotFoundException({
          message: error.message,
          code: 'API_KEY_NOT_FOUND',
        });
      }
      throw error;
    }
    return { revoked: true };
  }
}
