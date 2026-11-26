import {
  BadRequestException,
  Body,
  ConflictException,
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
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../../common/principal/access-policy.js';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../../common/principal/principal.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  CreatePublishableKey,
  ListPublishableKeys,
  RevokePublishableKey,
  SetPublishableKeyOrigins,
} from '../../application/use-cases/publishable-keys.js';
import {
  InvalidAllowedOriginsError,
  InvalidPublishableKeyLabelError,
  PublishableKeyNotFoundError,
  PublishableKeyRevokedError,
  type KeyWriter,
  type PublishableKey,
} from '../../domain/entities/publishable-key.js';

const origins = z.array(z.string().max(1000)).max(100);
const createSchema = z.object({
  label: z.string().max(1000),
  allowedOrigins: origins,
});
type CreateBody = z.output<typeof createSchema>;
const originsSchema = z.object({ allowedOrigins: origins });
type OriginsBody = z.output<typeof originsSchema>;

/** How the Console names a writer; a Super Admin acts for the platform. */
const PLATFORM_LABEL = 'Super Admin (PayBridge)';
const writerView = (writer: KeyWriter | null) => ({
  name: writer?.name ?? null,
  role: writer?.role ?? null,
  label: !writer
    ? null
    : writer.role === 'SUPER_ADMIN'
      ? PLATFORM_LABEL
      : writer.name,
});

const view = (key: PublishableKey) => ({
  id: key.id,
  label: key.label,
  key: key.key,
  allowedOrigins: key.allowedOrigins,
  createdAt: key.createdAt,
  updatedAt: key.updatedAt,
  revokedAt: key.revokedAt,
  createdBy: writerView(key.createdBy),
  updatedBy: writerView(key.updatedBy),
});

const principalOf = (request: Record<string, unknown>): Principal =>
  request[PRINCIPAL_REQUEST_KEY] as Principal;

/** The Organization the caller works in: one is always required. */
function organizationOf(request: Record<string, unknown>): string {
  const { organizationId } = principalOf(request);
  if (!organizationId) {
    throw new ForbiddenException({
      message: 'Choose one Organization to work in',
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  return organizationId;
}

/** The signed-in writer; a sensitive write has re-read their name. */
function writerOf(request: Record<string, unknown>): KeyWriter {
  const user = principalOf(request).user!;
  return { userId: user.id, role: user.role, name: user.name ?? null };
}

function mapError(error: unknown): never {
  if (error instanceof InvalidPublishableKeyLabelError) {
    throw new BadRequestException({
      message: error.message,
      code: 'INVALID_PUBLISHABLE_KEY_LABEL',
    });
  }
  if (error instanceof InvalidAllowedOriginsError) {
    throw new BadRequestException({
      message: error.message,
      code: 'INVALID_ALLOWED_ORIGINS',
    });
  }
  if (error instanceof PublishableKeyNotFoundError) {
    throw new NotFoundException({
      message: error.message,
      code: 'PUBLISHABLE_KEY_NOT_FOUND',
    });
  }
  if (error instanceof PublishableKeyRevokedError) {
    throw new ConflictException({
      message: error.message,
      code: 'PUBLISHABLE_KEY_REVOKED',
    });
  }
  throw error;
}

/**
 * Publishable Key management (ADR 0009). Creating, editing and revoking are
 * sensitive writes: the caller is re-checked in the database (ADR 0008). The
 * key is not secret, so listing shows it in full.
 */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/publishable-keys`)
export class PublishableKeysController {
  constructor(
    @Inject(CreatePublishableKey) private readonly createKey: CreatePublishableKey,
    @Inject(ListPublishableKeys) private readonly listKeys: ListPublishableKeys,
    @Inject(SetPublishableKeyOrigins)
    private readonly setOrigins: SetPublishableKeyOrigins,
    @Inject(RevokePublishableKey) private readonly revokeKey: RevokePublishableKey,
  ) {}

  @Post()
  @RequireSensitivePermission('publishable-keys:manage')
  @ApiOperation({ summary: 'Create a Publishable Key with its allowed origins' })
  async create(
    @Req() request: Record<string, unknown>,
    @Body(new ZodValidationPipe(createSchema)) body: CreateBody,
  ) {
    const organizationId = organizationOf(request);
    try {
      return view(
        await this.createKey.execute(organizationId, body, writerOf(request)),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Get()
  @RequirePermission('publishable-keys:manage')
  @ApiOperation({ summary: "List the Organization's Publishable Keys" })
  async list(@Req() request: Record<string, unknown>) {
    const items = await this.listKeys.execute(organizationOf(request));
    return { items: items.map(view) };
  }

  @Post(':id/allowed-origins')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('publishable-keys:manage')
  @ApiOperation({ summary: "Replace a Publishable Key's allowed origins" })
  async setAllowedOrigins(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(originsSchema)) body: OriginsBody,
  ) {
    const organizationId = organizationOf(request);
    try {
      return view(
        await this.setOrigins.execute(
          organizationId,
          id,
          body.allowedOrigins,
          writerOf(request),
        ),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('publishable-keys:manage')
  @ApiOperation({
    summary: 'Revoke a Publishable Key; it fails on its next request',
  })
  async revoke(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const organizationId = organizationOf(request);
    try {
      await this.revokeKey.execute(organizationId, id, writerOf(request));
    } catch (error) {
      return mapError(error);
    }
    return { revoked: true };
  }
}
