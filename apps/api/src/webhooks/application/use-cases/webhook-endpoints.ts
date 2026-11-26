import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type { PaymentEventKind } from '../../domain/entities/event-kinds.js';
import {
  InvalidWebhookUrlError,
  WebhookEndpointNotFoundError,
  type Actor,
  type WebhookEndpoint,
  type WebhookEndpointStatus,
} from '../../domain/entities/webhook-endpoint.js';
import { WebhooksTransactionRunner } from '../../domain/repositories/transaction-runner.js';
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
    @Inject(WebhooksTransactionRunner)
    private readonly runner: WebhooksTransactionRunner,
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

  list(scope: OrganizationScope): Promise<WebhookEndpoint[]> {
    return this.runner.repositories.endpoints.list(scope);
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
    return endpoint;
  }
}

function dedupe(kinds: readonly PaymentEventKind[]): PaymentEventKind[] {
  return [...new Set(kinds)];
}
