import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type { PaymentEventKind } from '../entities/event-kinds.js';
import type {
  NewWebhookEndpoint,
  SecretRoll,
  SecretRollRecord,
  WebhookEndpoint,
  WebhookEndpointChanges,
} from '../entities/webhook-endpoint.js';

/**
 * Persistence port for Webhook Endpoints. Every method takes the Organization
 * scope first (ADR 0006). A deleted endpoint is invisible to every method.
 */
export abstract class WebhookEndpointRepository {
  abstract create(
    scope: OrganizationScope,
    endpoint: NewWebhookEndpoint,
  ): Promise<WebhookEndpoint>;

  /** The Organization's endpoints, oldest first. */
  abstract list(scope: OrganizationScope): Promise<WebhookEndpoint[]>;

  abstract findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<WebhookEndpoint | null>;

  /** Null when the Organization has no such endpoint. */
  abstract update(
    scope: OrganizationScope,
    id: string,
    changes: WebhookEndpointChanges,
  ): Promise<WebhookEndpoint | null>;

  /** False when the Organization has no such endpoint. */
  abstract delete(
    scope: OrganizationScope,
    id: string,
    at: Date,
    changes: Pick<WebhookEndpointChanges, 'updatedBy'>,
  ): Promise<boolean>;

  /**
   * Replaces the signing secret and the previous one (any older previous
   * secret is dropped), and records the roll in the audit log. Null when the
   * Organization has no such endpoint.
   */
  abstract rollSecret(
    scope: OrganizationScope,
    id: string,
    roll: SecretRoll,
    recordId: string,
  ): Promise<WebhookEndpoint | null>;

  /** The audit log of an endpoint's secret rolls, newest first. */
  abstract listSecretRolls(
    scope: OrganizationScope,
    id: string,
  ): Promise<SecretRollRecord[]>;

  /** Enabled endpoints of the Organization that subscribe to `kind`. */
  abstract listSubscribed(
    scope: OrganizationScope,
    kind: PaymentEventKind,
  ): Promise<WebhookEndpoint[]>;
}
