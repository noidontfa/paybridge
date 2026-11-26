import type { GatewayConnection } from '../../domain/entities/gateway-connection.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../domain/value-objects/organization-scope.js';
import type { SealedValue } from '../../domain/services/credential-cipher.js';
import type {
  GatewayConnectionRepository,
  NewGatewayConnection,
} from '../../domain/repositories/repositories.js';
import type { DbContext } from './db.js';
import { scopeWhere } from './scope.js';
import { rethrowUniqueViolation } from './unique-violation.js';

/** Gateway Connections: one per Organization per gateway. */
export class PrismaGatewayConnectionRepository implements GatewayConnectionRepository {
  constructor(private readonly ctx: DbContext) {}

  list(scope: ReadScope): Promise<GatewayConnection[]> {
    return this.ctx.db.gatewayConnection.findMany({
      where: scopeWhere(scope),
      orderBy: [{ gatewayId: 'asc' }, { id: 'asc' }],
    });
  }

  findById(scope: ReadScope, id: string): Promise<GatewayConnection | null> {
    return this.ctx.db.gatewayConnection.findFirst({
      where: { ...scopeWhere(scope), id },
    });
  }

  findByGateway(
    scope: OrganizationScope,
    gatewayId: string,
  ): Promise<GatewayConnection | null> {
    return this.ctx.db.gatewayConnection.findUnique({
      where: {
        organizationId_gatewayId: {
          organizationId: scope.organizationId,
          gatewayId,
        },
      },
    });
  }

  create(
    scope: OrganizationScope,
    connection: NewGatewayConnection,
  ): Promise<GatewayConnection> {
    return rethrowUniqueViolation(
      this.ctx.db.gatewayConnection.create({
        data: {
          id: connection.id,
          organizationId: scope.organizationId,
          gatewayId: connection.gatewayId,
          credentialsCiphertext: connection.credentialsCiphertext,
          credentialsKeyId: connection.credentialsKeyId,
          enabled: connection.enabled ?? true,
        },
      }),
    );
  }

  /** New credentials: bumps the version so cached plugin instances are replaced. */
  replaceCredentials(
    scope: OrganizationScope,
    id: string,
    sealed: SealedValue,
  ): Promise<GatewayConnection> {
    return this.ctx.db.gatewayConnection.update({
      where: { id, organizationId: scope.organizationId },
      data: {
        credentialsCiphertext: sealed.ciphertext,
        credentialsKeyId: sealed.keyId,
        credentialsVersion: { increment: 1 },
      },
    });
  }

  /** Same credentials under another key (rotation): the version stays. */
  recrypt(
    scope: OrganizationScope,
    id: string,
    sealed: SealedValue,
  ): Promise<GatewayConnection> {
    return this.ctx.db.gatewayConnection.update({
      where: { id, organizationId: scope.organizationId },
      data: {
        credentialsCiphertext: sealed.ciphertext,
        credentialsKeyId: sealed.keyId,
      },
    });
  }

  setEnabled(
    scope: OrganizationScope,
    id: string,
    enabled: boolean,
  ): Promise<GatewayConnection> {
    return this.ctx.db.gatewayConnection.update({
      where: { id, organizationId: scope.organizationId },
      data: { enabled },
    });
  }

  async delete(scope: OrganizationScope, id: string): Promise<void> {
    await this.ctx.db.gatewayConnection.delete({
      where: { id, organizationId: scope.organizationId },
    });
  }

  /** True once any PaymentTransaction of the Organization used the gateway. */
  async isUsed(scope: OrganizationScope, gatewayId: string): Promise<boolean> {
    const count = await this.ctx.db.paymentTransaction.count({
      where: { organizationId: scope.organizationId, gatewayId },
    });
    return count > 0;
  }
}
