import {
  Body,
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
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../../common/principal/access-policy.js';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../../common/principal/principal.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  CreateOrganization,
  SetOrganizationSuspension,
} from '../../application/use-cases/manage-organizations.js';
import { EmailTakenError, InvitationPendingError } from '../../domain/errors.js';
import {
  OrganizationNotFoundError,
  type Organization,
} from '../../domain/entities/organization.js';
import { OrganizationRepository } from '../../domain/repositories/organization.repository.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  adminEmail: z.string().trim().min(3).max(320).includes('@'),
});

const present = ({ id, name, status, createdAt }: Organization) => ({
  id,
  name,
  status,
  createdAt: createdAt.toISOString(),
});

function rethrow(error: unknown): never {
  if (error instanceof OrganizationNotFoundError) {
    throw new NotFoundException({
      message: error.message,
      code: 'ORGANIZATION_NOT_FOUND',
    });
  }
  if (error instanceof EmailTakenError) {
    throw new ConflictException({ message: error.message, code: 'EMAIL_TAKEN' });
  }
  if (error instanceof InvitationPendingError) {
    throw new ConflictException({
      message: error.message,
      code: 'INVITATION_PENDING',
    });
  }
  throw error;
}

/** Organizations: the Super Admin's Platform area and Organization switcher. */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/organizations`)
export class OrganizationsController {
  constructor(
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
    @Inject(CreateOrganization) private readonly create: CreateOrganization,
    @Inject(SetOrganizationSuspension)
    private readonly suspension: SetOrganizationSuspension,
  ) {}

  @Get()
  @RequirePermission('organizations:manage')
  @ApiOperation({ summary: 'List Organizations (Super Admin)' })
  @ApiOkResponse({
    description: '`{ items: [{ id, name, status, createdAt }] }`',
  })
  async list() {
    const items = await this.organizations.list();
    return { items: items.map(present) };
  }

  @Post()
  @RequireSensitivePermission('organizations:manage')
  @ApiOperation({
    summary:
      'Create an Organization and invite its first Organization Admin (sensitive write)',
  })
  async createOrganization(
    @Req() request: Record<string, unknown>,
    @Body(new ZodValidationPipe(createSchema))
    body: z.output<typeof createSchema>,
  ) {
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal;
    try {
      return present(
        await this.create.execute({ userId: principal.user!.id }, body),
      );
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('organizations:manage')
  @ApiOperation({ summary: 'Suspend an Organization (sensitive write)' })
  async suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.suspension.suspend(id);
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('organizations:manage')
  @ApiOperation({ summary: 'Reactivate an Organization (sensitive write)' })
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.suspension.reactivate(id);
    } catch (error) {
      rethrow(error);
    }
  }
}
