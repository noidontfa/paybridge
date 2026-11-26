import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
  ListPendingInvitations,
  ResendInvitation,
  RevokeInvitation,
  SendInvitation,
  type InvitationManager,
} from '../../application/use-cases/manage-invitations.js';
import {
  EmailTakenError,
  InvitationNotFoundError,
  InvitationPendingError,
  InvitationRoleForbiddenError,
  OrganizationRequiredError,
} from '../../domain/errors.js';
import { ROLE_LABELS, USER_ROLES, type UserRole } from '../../domain/entities/user.js';
import type { Invitation } from '../../domain/entities/invitation.js';

const inviteSchema = z.object({
  email: z.string().trim().min(3).max(320).includes('@'),
  role: z.enum(USER_ROLES),
});

function manager(request: Record<string, unknown>): InvitationManager {
  const principal = request[PRINCIPAL_REQUEST_KEY] as Principal;
  return {
    userId: principal.user!.id,
    organizationId: principal.organizationId,
    allOrganizations: principal.allOrganizations,
    permissions: principal.user!.permissions,
  };
}

function present(invitation: Invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role as UserRole,
    roleLabel: ROLE_LABELS[invitation.role],
    organizationId: invitation.organizationId,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function rethrow(error: unknown): never {
  if (error instanceof EmailTakenError) {
    throw new ConflictException({ message: error.message, code: 'EMAIL_TAKEN' });
  }
  if (error instanceof InvitationPendingError) {
    throw new ConflictException({
      message: error.message,
      code: 'INVITATION_PENDING',
    });
  }
  if (error instanceof InvitationNotFoundError) {
    throw new NotFoundException({
      message: error.message,
      code: 'INVITATION_NOT_FOUND',
    });
  }
  if (error instanceof OrganizationRequiredError) {
    throw new BadRequestException({
      message: error.message,
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  if (error instanceof InvitationRoleForbiddenError) {
    throw new ForbiddenException({ message: error.message, code: 'FORBIDDEN' });
  }
  throw error;
}

/** Invitation management. Every write is sensitive (ADR 0008). */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/invitations`)
export class InvitationsController {
  constructor(
    @Inject(SendInvitation) private readonly send: SendInvitation,
    @Inject(ResendInvitation) private readonly resendUseCase: ResendInvitation,
    @Inject(RevokeInvitation) private readonly revokeUseCase: RevokeInvitation,
    @Inject(ListPendingInvitations)
    private readonly pending: ListPendingInvitations,
  ) {}

  @Get()
  @RequirePermission('users:manage')
  @ApiOperation({ summary: 'List pending Invitations with Role and expiry' })
  async list(@Req() request: Record<string, unknown>) {
    const items = await this.pending.execute(manager(request));
    return { items: items.map(present) };
  }

  @Post()
  @RequireSensitivePermission('users:manage')
  @ApiOperation({ summary: 'Invite an email with a Role (sensitive write)' })
  async invite(
    @Req() request: Record<string, unknown>,
    @Body(new ZodValidationPipe(inviteSchema))
    body: z.output<typeof inviteSchema>,
  ) {
    try {
      return present(await this.send.execute(manager(request), body));
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('users:manage')
  @ApiOperation({
    summary: 'Re-send an Invitation, voiding the previous link (sensitive write)',
  })
  async resend(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.resendUseCase.execute(manager(request), id);
    } catch (error) {
      rethrow(error);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('users:manage')
  @ApiOperation({ summary: 'Revoke a pending Invitation (sensitive write)' })
  async revoke(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.revokeUseCase.execute(manager(request), id);
    } catch (error) {
      rethrow(error);
    }
  }
}
