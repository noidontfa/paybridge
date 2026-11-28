import { Inject, Injectable } from '@nestjs/common';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
} from '../../../common/organization-scope.js';
import {
  CheckoutOrganizationSuspendedError,
  InvalidPublishableKeyError,
  isOriginAllowed,
  normaliseAllowedOrigins,
  normalisePublishableKeyLabel,
  OriginNotAllowedError,
  PublishableKeyNotFoundError,
  PublishableKeyRevokedError,
  type Actor,
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
    input: {
      readonly label: string;
      readonly allowedOrigins: readonly string[];
    },
    by: Actor,
  ): Promise<PublishableKey> {
    const label = normalisePublishableKeyLabel(input.label);
    const allowedOrigins = normaliseAllowedOrigins(
      input.allowedOrigins,
      this.rules,
    );
    return this.runner.repositories.publishableKeys.create(
      organizationScope(organizationId),
      {
        id: newIdentityId(),
        organizationId,
        label,
        key: generatePublishableKey(),
        allowedOrigins,
        createdBy: by,
        createdAt: this.clock.now(),
      },
    );
  }
}

@Injectable()
export class ListPublishableKeys {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  execute(organizationId: string): Promise<PublishableKey[]> {
    return this.runner.repositories.publishableKeys.list(
      organizationScope(organizationId),
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
    by: Actor,
  ): Promise<PublishableKey> {
    const origins = normaliseAllowedOrigins(allowedOrigins, this.rules);
    const scope = organizationScope(organizationId);
    return this.runner.run(async (repos) => {
      const found = await repos.publishableKeys.findById(scope, id);
      if (!found) throw new PublishableKeyNotFoundError(id);
      if (found.revokedAt) throw new PublishableKeyRevokedError(id);
      return repos.publishableKeys.setAllowedOrigins(
        scope,
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

  async execute(organizationId: string, id: string, by: Actor): Promise<void> {
    const scope = organizationScope(organizationId);
    await this.runner.run(async (repos) => {
      const found = await repos.publishableKeys.findById(scope, id);
      if (!found) throw new PublishableKeyNotFoundError(id);
      await repos.publishableKeys.revoke(scope, id, by, this.clock.now());
    });
  }
}

/** What a checkout request is allowed to act for. */
export interface CheckoutCaller {
  readonly organizationId: string;
  readonly publishableKeyId: string;
  readonly allowedOrigins: readonly string[];
  /**
   * The host page the request acts for, one of `allowedOrigins`: the
   * request's own `Origin`, or, from the checkout app, the host page it names.
   */
  readonly origin: string;
}

/**
 * Finds the Organization behind a Publishable Key presented from a browser.
 * An unknown or revoked key is refused, and so is a request whose `Origin`
 * is missing or not allowed for the key. A suspended Organization's key is
 * refused as "unavailable" (`CheckoutOrganizationSuspendedError`).
 */
@Injectable()
export class AuthenticatePublishableKey {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
    @Inject(PublishableKeyRules) private readonly rules: PublishableKeyRules,
  ) {}

  /**
   * `hostOrigin` counts only when `origin` is the checkout app's: its iframe
   * page acts for the host page it is embedded in, and that page's origin is
   * the one the key must allow. Anyone else is judged by their own `Origin`.
   */
  async execute(
    presented: string,
    requestOrigin: string | undefined,
    hostOrigin?: string,
  ): Promise<CheckoutCaller> {
    const origin = this.isCheckoutApp(requestOrigin)
      ? hostOrigin
      : requestOrigin;
    if (!looksLikePublishableKey(presented)) {
      throw new InvalidPublishableKeyError();
    }
    const stored = await this.runner.repositories.publishableKeys.findByKey(
      ALL_ORGANIZATIONS,
      presented,
    );
    if (!stored || stored.revokedAt) throw new InvalidPublishableKeyError();
    const organization = await this.organizations.findById(
      stored.organizationId,
    );
    if (!organization) throw new InvalidPublishableKeyError();
    if (!isOriginAllowed(stored, origin)) throw new OriginNotAllowedError();
    // Checked last, so only an allowed website learns the checkout is shut.
    if (organization.status !== 'ACTIVE') {
      throw new CheckoutOrganizationSuspendedError();
    }
    return {
      organizationId: stored.organizationId,
      publishableKeyId: stored.id,
      allowedOrigins: stored.allowedOrigins,
      origin: new URL(origin!).origin,
    };
  }

  private isCheckoutApp(origin: string | undefined): boolean {
    if (!origin || !URL.canParse(origin)) return false;
    return this.rules.checkoutAppOrigins.includes(new URL(origin).origin);
  }
}
