import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../common/principal/access-policy.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../constants.js';
import {
  ManageGatewayConnections,
  type GatewayConnectionView,
} from '../application/use-cases/manage-gateway-connections.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../domain/organization-scope.js';
import { CurrentReadScope, CurrentScope } from './current-scope.decorator.js';

const createSchema = z.object({
  gatewayId: z.string().min(1).max(64),
  credentials: z.record(z.string(), z.unknown()).optional(),
});
const replaceSchema = z.object({
  credentials: z.record(z.string(), z.unknown()),
});
type CreateBody = z.infer<typeof createSchema>;
type ReplaceBody = z.infer<typeof replaceSchema>;

/**
 * An Organization's Gateway Connections (ADR 0007). No response ever carries
 * credentials: only the names of the fields that are set.
 */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/gateway-connections`)
export class GatewayConnectionsController {
  constructor(
    @Inject(ManageGatewayConnections)
    private readonly connections: ManageGatewayConnections,
  ) {}

  @Get()
  @RequirePermission('gateway-connections:manage')
  @ApiOperation({ summary: 'List Gateway Connections (Organization Admin)' })
  @ApiOkResponse({ description: '`{ items }`; never contains a credential' })
  async list(
    @CurrentReadScope() scope: ReadScope,
  ): Promise<{ items: GatewayConnectionView[] }> {
    return { items: await this.connections.list(scope) };
  }

  @Post()
  @HttpCode(201)
  @RequireSensitivePermission('gateway-connections:manage')
  @ApiOperation({ summary: 'Connect a PaymentGateway (Organization Admin)' })
  create(
    @CurrentScope() scope: OrganizationScope,
    @Body(new ZodValidationPipe(createSchema)) body: CreateBody,
  ): Promise<GatewayConnectionView> {
    return this.connections.create(scope, body);
  }

  @Post(':id/credentials')
  @RequireSensitivePermission('gateway-connections:manage')
  @ApiOperation({ summary: 'Replace a Gateway Connection’s credentials' })
  replaceCredentials(
    @CurrentScope() scope: OrganizationScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(replaceSchema)) body: ReplaceBody,
  ): Promise<GatewayConnectionView> {
    return this.connections.replaceCredentials(scope, id, body.credentials);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequireSensitivePermission('gateway-connections:manage')
  @ApiOperation({ summary: 'Enable a Gateway Connection' })
  enable(
    @CurrentScope() scope: OrganizationScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GatewayConnectionView> {
    return this.connections.setEnabled(scope, id, true);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequireSensitivePermission('gateway-connections:manage')
  @ApiOperation({
    summary: 'Disable a Gateway Connection (stops new PaymentTransactions only)',
  })
  disable(
    @CurrentScope() scope: OrganizationScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GatewayConnectionView> {
    return this.connections.setEnabled(scope, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireSensitivePermission('gateway-connections:manage')
  @ApiOperation({ summary: 'Delete a Gateway Connection that was never used' })
  async remove(
    @CurrentScope() scope: OrganizationScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.connections.delete(scope, id);
  }
}
