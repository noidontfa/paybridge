import type { PaymentEventKind } from './event-kinds.js';

export type WebhookEndpointStatus = 'ENABLED' | 'DISABLED';

/** Who wrote an endpoint last: the signed-in User and the Role they held. */
export interface Actor {
  readonly userId: string;
  readonly role: string;
  readonly name: string;
}

/**
 * A URL of an Organization's system that receives Webhooks, with its own
 * signing secret (stored encrypted) and the Payment Event kinds it wants.
 */
export interface WebhookEndpoint {
  readonly id: string;
  readonly organizationId: string;
  readonly url: string;
  readonly eventKinds: readonly PaymentEventKind[];
  readonly status: WebhookEndpointStatus;
  readonly secretCiphertext: string;
  readonly secretKeyId: string;
  /** The first characters of the secret, safe to show. */
  readonly secretPrefix: string;
  readonly updatedBy: Actor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewWebhookEndpoint {
  readonly id: string;
  readonly url: string;
  readonly eventKinds: readonly PaymentEventKind[];
  readonly secretCiphertext: string;
  readonly secretKeyId: string;
  readonly secretPrefix: string;
  readonly updatedBy: Actor;
}

export interface WebhookEndpointChanges {
  readonly url?: string;
  readonly eventKinds?: readonly PaymentEventKind[];
  readonly status?: WebhookEndpointStatus;
  readonly updatedBy: Actor;
}

export class WebhookEndpointNotFoundError extends Error {
  override readonly name = 'WebhookEndpointNotFoundError';

  constructor(readonly endpointId: string) {
    super(`Webhook Endpoint ${endpointId} not found`);
  }
}

/** The URL is malformed, or points somewhere a Webhook may not go. */
export class InvalidWebhookUrlError extends Error {
  override readonly name = 'InvalidWebhookUrlError';
}

/** The label an endpoint's last writer is shown with: a Super Admin is the platform. */
export function actorLabel(actor: Actor): string | null {
  return actor.role === 'SUPER_ADMIN' ? 'Super Admin (PayBridge)' : null;
}
