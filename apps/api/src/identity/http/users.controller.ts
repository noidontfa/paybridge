import {
  ConflictException,
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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../common/principal/access-policy.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../common/principal/principal.js';
import { INTERNAL_PREFIX } from '../../constants.js';
import { ManageUsers } from '../application/use-cases/manage-users.js';
import {
  LastOrganizationAdminError,
  UserNotFoundError,
} from '../domain/errors.js';
import { MANAGED_ROLES, ROLE_LABELS, type User } from '../domain/user.js';

const roleSchema = z.object({
  role: z.enum(MANAGED_ROLES),
});

/** The one Organization the call works in: the caller's, or a Super Admin's choice. */
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

function rethrow(error: unknown): never {
  if (error instanceof UserNotFoundError) {
    throw new NotFoundException({
      message: error.message,
      code: 'USER_NOT_FOUND',
    });
  }
  if (error instanceof LastOrganizationAdminError) {
    throw new ConflictException({
      message: error.message,
      code: 'LAST_ORGANIZATION_ADMIN',
    });
  }
  throw error;
}

const toView = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  roleLabel: ROLE_LABELS[user.role],
  active: user.active,
  createdAt: user.createdAt.toISOString(),
});

/** An Organization's Users. Writes are sensitive: re-checked in the database. */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/users`)
export class UsersController {
  constructor(@Inject(ManageUsers) private readonly users: ManageUsers) {}

  @Get()
  @RequirePermission('users:manage')
  @ApiOperation({ summary: "List the Organization's Users" })
  @ApiOkResponse({
    description: '`{ items: [{ id, email, name, role, roleLabel, active }] }`',
  })
  async list(@Req() request: Record<string, unknown>) {
    const users = await this.users.list(organizationOf(request));
    return { items: users.map(toView) };
  }

  @Post(':id/role')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('users:manage')
  @ApiOperation({ summary: 'Change a User Role (sensitive write)' })
  async changeRole(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(roleSchema)) body: z.output<typeof roleSchema>,
  ): Promise<Record<string, never>> {
    try {
      await this.users.changeRole(organizationOf(request), id, body.role);
    } catch (error) {
      rethrow(error);
    }
    return {};
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('users:manage')
  @ApiOperation({ summary: 'Deactivate a User (sensitive write)' })
  async deactivate(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.users.deactivate(organizationOf(request), id);
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireSensitivePermission('users:manage')
  @ApiOperation({ summary: 'Reactivate a User (sensitive write)' })
  async reactivate(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    try {
      await this.users.reactivate(organizationOf(request), id);
    } catch (error) {
      rethrow(error);
    }
  }
}
