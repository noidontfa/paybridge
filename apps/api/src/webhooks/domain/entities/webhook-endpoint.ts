import type { Actor } from '../../../common/principal/actor.js';
import type { PaymentEventKind } from './event-kinds.js';

// Who wrote an endpoint (or rolled its secret, or resent a delivery): the
// one Actor shape every module records.
export type { Actor };

export type WebhookEndpointStatus = 'ENABLED' | 'DISABLED';

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
  /** The secret before the last roll, while it may still be valid. */
  readonly previousSecret: PreviousSecret | null;
  readonly updatedBy: Actor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A rolled-over signing secret (encrypted) and when it stops signing. */
export interface PreviousSecret {
  readonly ciphertext: string;
  readonly keyId: string;
  readonly expiresAt: Date;
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

/**
 * How long the previous secret stays valid after a roll: not at all, an hour
 * or a day. A short list, so a forgotten old secret cannot linger.
 */
export const SECRET_OVERLAPS = {
  now: 0,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
} as const;
export type SecretOverlap = keyof typeof SECRET_OVERLAPS;

/** A new signing secret, and the current one kept until `expiresAt`. */
export interface SecretRoll {
  readonly secretCiphertext: string;
  readonly secretKeyId: string;
  readonly secretPrefix: string;
  /** Null when the old secret ends at once. */
  readonly previousSecret: PreviousSecret | null;
  readonly rolledAt: Date;
  readonly rolledBy: Actor;
}

/** One entry of an endpoint's audit log of secret rolls. */
export interface SecretRollRecord {
  readonly rolledAt: Date;
  readonly previousSecretExpiresAt: Date | null;
  readonly rolledBy: Actor;
}

/** The previous secret if it still signs at `at`, else null. */
export function validPreviousSecret(
  endpoint: Pick<WebhookEndpoint, 'previousSecret'>,
  at: Date,
): PreviousSecret | null {
  const previous = endpoint.previousSecret;
  return previous && previous.expiresAt.getTime() > at.getTime()
    ? previous
    : null;
}
