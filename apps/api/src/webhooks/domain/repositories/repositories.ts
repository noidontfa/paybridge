import type { ManualAttemptRepository } from './manual-attempt.repository.js';
import type { WebhookDeliveryRepository } from './webhook-delivery.repository.js';
import type { WebhookEndpointRepository } from './webhook-endpoint.repository.js';

/** Every webhooks repository, bound to one database handle. */
export interface Repositories {
  readonly endpoints: WebhookEndpointRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly manualAttempts: ManualAttemptRepository;
}
