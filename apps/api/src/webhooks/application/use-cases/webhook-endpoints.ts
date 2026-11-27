import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type { PaymentEventKind } from '../../domain/entities/event-kinds.js';
import {
  InvalidWebhookUrlError,
  SECRET_OVERLAPS,
  validPreviousSecret,
  WebhookEndpointNotFoundError,
  type Actor,
  type SecretOverlap,
  type SecretRollRecord,
  type WebhookEndpoint,
  type WebhookEndpointStatus,
} from '../../domain/entities/webhook-endpoint.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import {
  newWebhookId,
  SecretCipher,
  WebhooksClock,
  WebhookUrlGuard,
} from '../../domain/services/ports.js';
import { generateWebhookSecret } from '../webhook-secret.js';

export interface WebhookEndpointInput {
  readonly url: string;
  readonly eventKinds: readonly PaymentEventKind[];
}

export interface CreatedWebhookEndpoint {
  readonly endpoint: WebhookEndpoint;
  /** The full signing secret. It exists only in this result. */
  readonly secret: string;
}

/**
 * Webhook Endpoint management for an Organization Admin (or a Super Admin
 * working in the Organization). Every write records who made it.
 */
@Injectable()
export class ManageWebhookEndpoints {
  constructor(
    @Inject(TransactionRunner)
    private readonly runner: TransactionRunner,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(WebhookUrlGuard) private readonly urlGuard: WebhookUrlGuard,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
  ) {}

  async create(
    scope: OrganizationScope,
    input: WebhookEndpointInput,
    actor: Actor,
  ): Promise<CreatedWebhookEndpoint> {
    await this.checkUrl(input.url);
    const { secret, prefix } = generateWebhookSecret();
    const sealed = this.cipher.encrypt(secret);
    const endpoint = await this.runner.repositories.endpoints.create(scope, {
      id: newWebhookId(),
      url: input.url,
      eventKinds: dedupe(input.eventKinds),
      secretCiphertext: sealed.ciphertext,
      secretKeyId: sealed.keyId,
      secretPrefix: prefix,
      updatedBy: actor,
    });
    return { endpoint, secret };
  }

  async list(scope: OrganizationScope): Promise<WebhookEndpoint[]> {
    const endpoints = await this.runner.repositories.endpoints.list(scope);
    return endpoints.map((e) => this.current(e));
  }

  /**
   * Replaces the signing secret. The current one keeps signing for `overlap`
   * (and replaces any older previous secret), so the Organization can update
   * its receiver without rejecting a delivery. Recorded in the audit log.
   */
  async rollSecret(
    scope: OrganizationScope,
    id: string,
    overlap: SecretOverlap,
    actor: Actor,
  ): Promise<CreatedWebhookEndpoint> {
    const { secret, prefix } = generateWebhookSecret();
    const sealed = this.cipher.encrypt(secret);
    const now = this.clock.now();
    const endpoint = await this.runner.run(async (tx) => {
      const existing = await tx.endpoints.findById(scope, id);
      if (!existing) return null;
      const validFor = SECRET_OVERLAPS[overlap];
      return tx.endpoints.rollSecret(
        scope,
        id,
        {
          secretCiphertext: sealed.ciphertext,
          secretKeyId: sealed.keyId,
          secretPrefix: prefix,
          previousSecret:
            validFor > 0
              ? {
                  ciphertext: existing.secretCiphertext,
                  keyId: existing.secretKeyId,
                  expiresAt: new Date(now.getTime() + validFor),
                }
              : null,
          rolledAt: now,
          rolledBy: actor,
        },
        newWebhookId(),
      );
    });
    return { endpoint: this.found(id, endpoint), secret };
  }

  /** The audit log of an endpoint's secret rolls, newest first. */
  async secretRolls(
    scope: OrganizationScope,
    id: string,
  ): Promise<SecretRollRecord[]> {
    const endpoints = this.runner.repositories.endpoints;
    this.found(id, await endpoints.findById(scope, id));
    return endpoints.listSecretRolls(scope, id);
  }

  async update(
    scope: OrganizationScope,
    id: string,
    input: Partial<WebhookEndpointInput>,
    actor: Actor,
  ): Promise<WebhookEndpoint> {
    if (input.url !== undefined) await this.checkUrl(input.url);
    return this.found(
      id,
      await this.runner.repositories.endpoints.update(scope, id, {
        url: input.url,
        eventKinds: input.eventKinds && dedupe(input.eventKinds),
        updatedBy: actor,
      }),
    );
  }

  async setStatus(
    scope: OrganizationScope,
    id: string,
    status: WebhookEndpointStatus,
    actor: Actor,
  ): Promise<WebhookEndpoint> {
    return this.found(
      id,
      await this.runner.repositories.endpoints.update(scope, id, {
        status,
        updatedBy: actor,
      }),
    );
  }

  /** Deliveries keep pointing at a deleted endpoint; it gets no new ones. */
  async delete(
    scope: OrganizationScope,
    id: string,
    actor: Actor,
  ): Promise<void> {
    const deleted = await this.runner.repositories.endpoints.delete(
      scope,
      id,
      this.clock.now(),
      { updatedBy: actor },
    );
    if (!deleted) throw new WebhookEndpointNotFoundError(id);
  }

  private async checkUrl(url: string): Promise<void> {
    const reason = await this.urlGuard.check(url);
    if (reason) throw new InvalidWebhookUrlError(reason);
  }

  private found(id: string, endpoint: WebhookEndpoint | null): WebhookEndpoint {
    if (!endpoint) throw new WebhookEndpointNotFoundError(id);
    return this.current(endpoint);
  }

  /** Drops a previous secret whose end time has passed. */
  private current(endpoint: WebhookEndpoint): WebhookEndpoint {
    return {
      ...endpoint,
      previousSecret: validPreviousSecret(endpoint, this.clock.now()),
    };
  }
}

function dedupe(kinds: readonly PaymentEventKind[]): PaymentEventKind[] {
  return [...new Set(kinds)];
}
