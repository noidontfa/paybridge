import { Inject, Injectable } from '@nestjs/common';
import {
  ApiKeyNotFoundError,
  InvalidApiKeyError,
  normaliseApiKeyLabel,
  type ApiKey,
} from '../../domain/entities/api-key.js';
import { newIdentityId } from '../../domain/ids.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';
import { OrganizationRepository } from '../../domain/repositories/organization.repository.js';
import { generateApiKey, hashApiKey, looksLikeApiKey } from '../api-key-secret.js';

export interface CreatedApiKey {
  readonly apiKey: ApiKey;
  /** The full key. It exists only in this result and is never stored. */
  readonly key: string;
}

/** Creates a key for an Organization; the full key is returned once. */
@Injectable()
export class CreateApiKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  async execute(
    organizationId: string,
    label: string,
  ): Promise<CreatedApiKey> {
    const normalised = normaliseApiKeyLabel(label);
    const generated = generateApiKey();
    const apiKey = await this.runner.repositories.apiKeys.create({
      id: newIdentityId(),
      organizationId,
      label: normalised,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
    });
    return { apiKey, key: generated.key };
  }
}

@Injectable()
export class ListApiKeys {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  execute(organizationId: string): Promise<ApiKey[]> {
    return this.runner.repositories.apiKeys.listOfOrganization(organizationId);
  }
}

/** Revokes a key of the Organization. Revoking twice is harmless. */
@Injectable()
export class RevokeApiKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(organizationId: string, id: string): Promise<void> {
    const found = await this.runner.repositories.apiKeys.revoke(
      organizationId,
      id,
      this.clock.now(),
    );
    if (!found) throw new ApiKeyNotFoundError(id);
  }
}

/**
 * Finds the Organization behind a presented key. An unknown or revoked key,
 * or one of a suspended Organization, is refused; a good one has its
 * last-used time recorded.
 */
@Injectable()
export class AuthenticateApiKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
  ) {}

  async execute(presented: string): Promise<{ organizationId: string }> {
    if (!looksLikeApiKey(presented)) throw new InvalidApiKeyError();
    const keys = this.runner.repositories.apiKeys;
    const stored = await keys.findByHash(hashApiKey(presented));
    if (!stored || stored.revokedAt) throw new InvalidApiKeyError();
    const organization = await this.organizations.findById(
      stored.organizationId,
    );
    if (!organization || organization.status !== 'ACTIVE') {
      throw new InvalidApiKeyError();
    }
    await keys.touch(stored.id, this.clock.now());
    return { organizationId: stored.organizationId };
  }
}
