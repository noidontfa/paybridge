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
import { SendInvitation } from '../../application/use-cases/manage-invitations.js';
import { ManageSuperAdmins } from '../../application/use-cases/manage-super-admins.js';
import {
  EmailTakenError,
  InvitationPendingError,
  LastSuperAdminError,
  UserNotFoundError,
} from '../../domain/errors.js';
import { ROLE_LABELS, type User } from '../../domain/entities/user.js';

const inviteSchema = z.object({
  email: z.string().trim().min(3).max(320).includes('@'),
});

const toView = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  roleLabel: ROLE_LABELS[user.role],
  active: user.active,
  createdAt: user.createdAt.toISOString(),
});

function rethrow(error: unknown): never {
  if (error instanceof UserNotFoundError) {
    throw new NotFoundException({
      message: 'Super Admin not found',
      code: 'USER_NOT_FOUND',
    });
  }
  if (error instanceof LastSuperAdminError) {
    throw new ConflictException({
      message: error.message,
      code: 'LAST_SUPER_ADMIN',
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

/** The platform team. Every write is sensitive: re-checked in the database. */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/super-admins`)
export class SuperAdminsController {
  constructor(
    @Inject(ManageSuperAdmins) private readonly admins: ManageSuperAdmins,
    @Inject(SendInvitation) private readonly invitations: SendInvitation,
  ) {}

  @Get()
  @RequirePermission('super-admins:manage')
  @ApiOperation({ summary: 'List Super Admins' })
  @ApiOkResponse({
    description: '`{ items: [{ id, email, name, role, roleLabel, active }] }`',
  })
  async list() {
    return { items: (await this.admins.list()).map(toView) };
  }

  @Post('invitations')
  @RequireSensitivePermission('super-admins:manage')
  @ApiOperation({ summary: 'Invite another Super Admin (sensitive write)' })
  async invite(
    @Req() request: Record<string, unknown>,
    @Body(new ZodValidationPipe(inviteSchema))
    body: z.output<typeof inviteSchema>,
  ) {
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal;
    try {
      const invitation = await this.invitations.execute(
        {
          userId: principal.user!.id,
          organizationId: null,
          permissions: principal.user!.permissions,
        },
        { email: body.email, role: 'SUPER_ADMIN' },
      );
      return {
        id: invitation.id,
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
      };
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('super-admins:manage')
  @ApiOperation({ summary: 'Deactivate a Super Admin (sensitive write)' })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.admins.deactivate(id);
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('super-admins:manage')
  @ApiOperation({ summary: 'Reactivate a Super Admin (sensitive write)' })
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.admins.reactivate(id);
    } catch (error) {
      rethrow(error);
    }
  }
}
