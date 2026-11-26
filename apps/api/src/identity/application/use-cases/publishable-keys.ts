import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidPublishableKeyError,
  isOriginAllowed,
  normaliseAllowedOrigins,
  normalisePublishableKeyLabel,
  OriginNotAllowedError,
  PublishableKeyNotFoundError,
  PublishableKeyRevokedError,
  type KeyWriter,
  type PublishableKey,
} from '../../domain/entities/publishable-key.js';
import { newIdentityId } from '../../domain/ids.js';
import { OrganizationRepository } from '../../domain/repositories/organization.repository.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';
import { PublishableKeyRules } from '../../domain/services/publishable-key-rules.js';
import {
  generatePublishableKey,
  looksLikePublishableKey,
} from '../publishable-key-secret.js';

/** Creates a key for an Organization with at least one allowed origin. */
@Injectable()
export class CreatePublishableKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(PublishableKeyRules) private readonly rules: PublishableKeyRules,
  ) {}

  execute(
    organizationId: string,
    input: { readonly label: string; readonly allowedOrigins: readonly string[] },
    by: KeyWriter,
  ): Promise<PublishableKey> {
    const label = normalisePublishableKeyLabel(input.label);
    const allowedOrigins = normaliseAllowedOrigins(
      input.allowedOrigins,
      this.rules,
    );
    return this.runner.repositories.publishableKeys.create({
      id: newIdentityId(),
      organizationId,
      label,
      key: generatePublishableKey(),
      allowedOrigins,
      createdBy: by,
      createdAt: this.clock.now(),
    });
  }
}

@Injectable()
export class ListPublishableKeys {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  execute(organizationId: string): Promise<PublishableKey[]> {
    return this.runner.repositories.publishableKeys.listOfOrganization(
      organizationId,
    );
  }
}

/** Replaces a key's allowed origins. A revoked key cannot be edited. */
@Injectable()
export class SetPublishableKeyOrigins {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(PublishableKeyRules) private readonly rules: PublishableKeyRules,
  ) {}

  async execute(
    organizationId: string,
    id: string,
    allowedOrigins: readonly string[],
    by: KeyWriter,
  ): Promise<PublishableKey> {
    const origins = normaliseAllowedOrigins(allowedOrigins, this.rules);
    return this.runner.run(async (repos) => {
      const found = await repos.publishableKeys.findOfOrganization(
        organizationId,
        id,
      );
      if (!found) throw new PublishableKeyNotFoundError(id);
      if (found.revokedAt) throw new PublishableKeyRevokedError(id);
      return repos.publishableKeys.setAllowedOrigins(
        organizationId,
        id,
        origins,
        by,
        this.clock.now(),
      );
    });
  }
}

/** Revokes a key of the Organization. Revoking twice is harmless. */
@Injectable()
export class RevokePublishableKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(organizationId: string, id: string, by: KeyWriter): Promise<void> {
    await this.runner.run(async (repos) => {
      const found = await repos.publishableKeys.findOfOrganization(
        organizationId,
        id,
      );
      if (!found) throw new PublishableKeyNotFoundError(id);
      await repos.publishableKeys.revoke(organizationId, id, by, this.clock.now());
    });
  }
}

/** What a checkout request is allowed to act for. */
export interface CheckoutCaller {
  readonly organizationId: string;
  readonly publishableKeyId: string;
  readonly allowedOrigins: readonly string[];
  /** The request's own origin, one of `allowedOrigins`. */
  readonly origin: string;
}

/**
 * Finds the Organization behind a Publishable Key presented from a browser.
 * An unknown or revoked key, or one of a suspended Organization, is refused;
 * so is a request whose `Origin` is missing or not allowed for the key.
 */
@Injectable()
export class AuthenticatePublishableKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
  ) {}

  async execute(
    presented: string,
    origin: string | undefined,
  ): Promise<CheckoutCaller> {
    if (!looksLikePublishableKey(presented)) {
      throw new InvalidPublishableKeyError();
    }
    const stored =
      await this.runner.repositories.publishableKeys.findByKey(presented);
    if (!stored || stored.revokedAt) throw new InvalidPublishableKeyError();
    const organization = await this.organizations.findById(
      stored.organizationId,
    );
    if (!organization || organization.status !== 'ACTIVE') {
      throw new InvalidPublishableKeyError();
    }
    if (!isOriginAllowed(stored, origin)) throw new OriginNotAllowedError();
    return {
      organizationId: stored.organizationId,
      publishableKeyId: stored.id,
      allowedOrigins: stored.allowedOrigins,
      origin: new URL(origin!).origin,
    };
  }
}
