import { Inject, Injectable } from '@nestjs/common';
import {
  GatewayConnectionExistsError,
  GatewayConnectionNotFoundError,
  GatewayConnectionUsedError,
  InvalidGatewayCredentialsError,
  UnknownGatewayIdError,
} from '../../domain/errors.js';
import { newId } from '../../domain/ids.js';
import type { GatewayConnection } from '../../domain/entities/gateway-connection.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../domain/value-objects/organization-scope.js';
import { organizationScope } from '../../domain/value-objects/organization-scope.js';
import { UniqueViolationError } from '../../domain/repositories/repositories.js';
import { GatewayManager } from '../gateway-manager.js';
import { CredentialCipher } from '../../domain/services/credential-cipher.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';

/** What a response may say about a Gateway Connection: never the credentials. */
export interface GatewayConnectionView {
  readonly id: string;
  readonly organizationId: string;
  readonly gatewayId: string;
  readonly enabled: boolean;
  readonly credentialsVersion: number;
  /** Names of the credential fields that are set; their values are never returned. */
  readonly credentialFields: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Organization Admins manage their Organization's Gateway Connections
 * (ADR 0007): connect, replace credentials, enable, disable, and delete one
 * that was never used.
 */
@Injectable()
export class ManageGatewayConnections {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(CredentialCipher) private readonly cipher: CredentialCipher,
  ) {}

  async list(scope: ReadScope): Promise<GatewayConnectionView[]> {
    const rows = await this.runner.repositories.gatewayConnections.list(scope);
    return rows.map((row) => this.view(row));
  }

  async create(
    scope: OrganizationScope,
    input: { gatewayId: string; credentials?: unknown },
  ): Promise<GatewayConnectionView> {
    const sealed = this.seal(input.gatewayId, input.credentials);
    try {
      const row = await this.runner.repositories.gatewayConnections.create(
        scope,
        {
          id: newId(),
          gatewayId: input.gatewayId,
          credentialsCiphertext: sealed?.ciphertext ?? null,
          credentialsKeyId: sealed?.keyId ?? null,
        },
      );
      return this.view(row);
    } catch (error) {
      if (error instanceof UniqueViolationError) {
        throw new GatewayConnectionExistsError(input.gatewayId);
      }
      throw error;
    }
  }

  async replaceCredentials(
    scope: OrganizationScope,
    id: string,
    credentials: unknown,
  ): Promise<GatewayConnectionView> {
    const repo = this.runner.repositories.gatewayConnections;
    const existing = await this.require(scope, id);
    const sealed = this.seal(existing.gatewayId, credentials);
    if (!sealed) {
      throw new InvalidGatewayCredentialsError(existing.gatewayId, [
        'this gateway takes no credentials',
      ]);
    }
    return this.view(await repo.replaceCredentials(scope, id, sealed));
  }

  async setEnabled(
    scope: OrganizationScope,
    id: string,
    enabled: boolean,
  ): Promise<GatewayConnectionView> {
    await this.require(scope, id);
    return this.view(
      await this.runner.repositories.gatewayConnections.setEnabled(
        scope,
        id,
        enabled,
      ),
    );
  }

  async delete(scope: OrganizationScope, id: string): Promise<void> {
    const repo = this.runner.repositories.gatewayConnections;
    const existing = await this.require(scope, id);
    if (await repo.isUsed(scope, existing.gatewayId)) {
      throw new GatewayConnectionUsedError(id);
    }
    await repo.delete(scope, id);
  }

  private async require(
    scope: OrganizationScope,
    id: string,
  ): Promise<GatewayConnection> {
    const row = await this.runner.repositories.gatewayConnections.findById(
      scope,
      id,
    );
    if (!row) throw new GatewayConnectionNotFoundError(id);
    return row;
  }

  /** Validates the credentials for the gateway, then encrypts them. */
  private seal(
    gatewayId: string,
    credentials: unknown,
  ): { ciphertext: string; keyId: string } | null {
    if (!this.gateways.isRegistered(gatewayId)) {
      throw new UnknownGatewayIdError(gatewayId);
    }
    const schema = this.gateways.credentialsSchema(gatewayId);
    if (!schema) {
      if (credentials !== undefined && credentials !== null) {
        throw new InvalidGatewayCredentialsError(gatewayId, [
          'this gateway takes no credentials',
        ]);
      }
      return null;
    }
    const parsed = schema.safeParse(credentials);
    if (!parsed.success) {
      throw new InvalidGatewayCredentialsError(
        gatewayId,
        parsed.error.issues.map(
          (i) =>
            `${i.path.map(String).join('.') || 'credentials'}: ${i.message}`,
        ),
      );
    }
    return this.cipher.encrypt(JSON.stringify(parsed.data));
  }

  private view(row: GatewayConnection): GatewayConnectionView {
    return {
      id: row.id,
      organizationId: row.organizationId,
      gatewayId: row.gatewayId,
      enabled: row.enabled,
      credentialsVersion: row.credentialsVersion,
      credentialFields: this.fieldNames(row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private fieldNames(row: GatewayConnection): string[] {
    if (!row.credentialsCiphertext || !row.credentialsKeyId) return [];
    const stored = JSON.parse(
      this.cipher.decrypt({
        ciphertext: row.credentialsCiphertext,
        keyId: row.credentialsKeyId,
      }),
    ) as Record<string, unknown>;
    return Object.entries(stored)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k]) => k)
      .sort();
  }
}

/**
 * Re-encrypts every Gateway Connection's credentials under the primary key
 * (key rotation). Returns how many rows it rewrote.
 */
@Injectable()
export class ReencryptGatewayCredentials {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CredentialCipher) private readonly cipher: CredentialCipher,
  ) {}

  async execute(allOrganizations: ReadScope): Promise<number> {
    const repo = this.runner.repositories.gatewayConnections;
    let rewritten = 0;
    for (const row of await repo.list(allOrganizations)) {
      if (!row.credentialsCiphertext || !row.credentialsKeyId) continue;
      if (row.credentialsKeyId === this.cipher.primaryKeyId) continue;
      const plain = this.cipher.decrypt({
        ciphertext: row.credentialsCiphertext,
        keyId: row.credentialsKeyId,
      });
      await repo.recrypt(
        organizationScope(row.organizationId),
        row.id,
        this.cipher.encrypt(plain),
      );
      rewritten += 1;
    }
    return rewritten;
  }
}
