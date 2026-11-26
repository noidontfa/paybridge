import type { WebhookEndpoint as Row } from '../../../generated/prisma/client.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type { PaymentEventKind } from '../../domain/entities/event-kinds.js';
import type {
  Actor,
  NewWebhookEndpoint,
  SecretRoll,
  SecretRollRecord,
  WebhookEndpoint,
  WebhookEndpointChanges,
} from '../../domain/entities/webhook-endpoint.js';
import { WebhookEndpointRepository } from '../../domain/repositories/webhook-endpoint.repository.js';
import type { DbContext } from './db.js';

function toEndpoint(row: Row): WebhookEndpoint {
  return {
    id: row.id,
    organizationId: row.organizationId,
    url: row.url,
    eventKinds: row.eventKinds as PaymentEventKind[],
    status: row.status,
    secretCiphertext: row.secretCiphertext,
    secretKeyId: row.secretKeyId,
    secretPrefix: row.secretPrefix,
    previousSecret:
      row.previousSecretCiphertext &&
      row.previousSecretKeyId &&
      row.previousSecretExpiresAt
        ? {
            ciphertext: row.previousSecretCiphertext,
            keyId: row.previousSecretKeyId,
            expiresAt: row.previousSecretExpiresAt,
          }
        : null,
    updatedBy: {
      userId: row.updatedByUserId,
      role: row.updatedByRole,
      name: row.updatedByName,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const writer = (actor: Actor) => ({
  updatedByUserId: actor.userId,
  updatedByRole: actor.role,
  updatedByName: actor.name,
});

/** Webhook Endpoints in `wh_endpoints`. Deleted rows stay, invisible. */
export class PrismaWebhookEndpointRepository extends WebhookEndpointRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(
    scope: OrganizationScope,
    endpoint: NewWebhookEndpoint,
  ): Promise<WebhookEndpoint> {
    const row = await this.ctx.db.webhookEndpoint.create({
      data: {
        id: endpoint.id,
        organizationId: scope.organizationId,
        url: endpoint.url,
        eventKinds: [...endpoint.eventKinds],
        secretCiphertext: endpoint.secretCiphertext,
        secretKeyId: endpoint.secretKeyId,
        secretPrefix: endpoint.secretPrefix,
        ...writer(endpoint.updatedBy),
      },
    });
    return toEndpoint(row);
  }

  async list(scope: OrganizationScope): Promise<WebhookEndpoint[]> {
    const rows = await this.ctx.db.webhookEndpoint.findMany({
      where: { organizationId: scope.organizationId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEndpoint);
  }

  async findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<WebhookEndpoint | null> {
    const row = await this.ctx.db.webhookEndpoint.findFirst({
      where: { id, organizationId: scope.organizationId, deletedAt: null },
    });
    return row && toEndpoint(row);
  }

  async update(
    scope: OrganizationScope,
    id: string,
    changes: WebhookEndpointChanges,
  ): Promise<WebhookEndpoint | null> {
    const { count } = await this.ctx.db.webhookEndpoint.updateMany({
      where: { id, organizationId: scope.organizationId, deletedAt: null },
      data: {
        url: changes.url,
        eventKinds: changes.eventKinds && [...changes.eventKinds],
        status: changes.status,
        ...writer(changes.updatedBy),
      },
    });
    return count === 0 ? null : this.findById(scope, id);
  }

  async delete(
    scope: OrganizationScope,
    id: string,
    at: Date,
    changes: Pick<WebhookEndpointChanges, 'updatedBy'>,
  ): Promise<boolean> {
    const { count } = await this.ctx.db.webhookEndpoint.updateMany({
      where: { id, organizationId: scope.organizationId, deletedAt: null },
      data: { deletedAt: at, ...writer(changes.updatedBy) },
    });
    return count > 0;
  }

  async rollSecret(
    scope: OrganizationScope,
    id: string,
    roll: SecretRoll,
    recordId: string,
  ): Promise<WebhookEndpoint | null> {
    const { count } = await this.ctx.db.webhookEndpoint.updateMany({
      where: { id, organizationId: scope.organizationId, deletedAt: null },
      data: {
        secretCiphertext: roll.secretCiphertext,
        secretKeyId: roll.secretKeyId,
        secretPrefix: roll.secretPrefix,
        previousSecretCiphertext: roll.previousSecret?.ciphertext ?? null,
        previousSecretKeyId: roll.previousSecret?.keyId ?? null,
        previousSecretExpiresAt: roll.previousSecret?.expiresAt ?? null,
        ...writer(roll.rolledBy),
      },
    });
    if (count === 0) return null;
    await this.ctx.db.webhookSecretRoll.create({
      data: {
        id: recordId,
        organizationId: scope.organizationId,
        endpointId: id,
        rolledAt: roll.rolledAt,
        previousSecretExpiresAt: roll.previousSecret?.expiresAt ?? null,
        rolledByUserId: roll.rolledBy.userId,
        rolledByRole: roll.rolledBy.role,
        rolledByName: roll.rolledBy.name,
      },
    });
    return this.findById(scope, id);
  }

  async listSecretRolls(
    scope: OrganizationScope,
    id: string,
  ): Promise<SecretRollRecord[]> {
    const rows = await this.ctx.db.webhookSecretRoll.findMany({
      where: { endpointId: id, organizationId: scope.organizationId },
      orderBy: [{ rolledAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => ({
      rolledAt: row.rolledAt,
      previousSecretExpiresAt: row.previousSecretExpiresAt,
      rolledBy: {
        userId: row.rolledByUserId,
        role: row.rolledByRole,
        name: row.rolledByName,
      },
    }));
  }

  async listSubscribed(
    scope: OrganizationScope,
    kind: PaymentEventKind,
  ): Promise<WebhookEndpoint[]> {
    const rows = await this.ctx.db.webhookEndpoint.findMany({
      where: {
        organizationId: scope.organizationId,
        deletedAt: null,
        status: 'ENABLED',
        eventKinds: { has: kind },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map(toEndpoint);
  }
}
