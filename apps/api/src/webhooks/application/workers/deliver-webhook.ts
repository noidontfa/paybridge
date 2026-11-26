import { Inject, Injectable } from '@nestjs/common';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
} from '../../../payment-core/port/organization-scope.js';
import {
  envelopeOf,
  type DeliveryAttemptResult,
} from '../../domain/entities/webhook-delivery.js';
import { validPreviousSecret } from '../../domain/entities/webhook-endpoint.js';
import { WebhooksTransactionRunner } from '../../domain/repositories/transaction-runner.js';
import {
  newWebhookId,
  SecretCipher,
  WebhooksClock,
  WebhookSender,
} from '../../domain/services/ports.js';
import {
  SIGNATURE_HEADER,
  signatureHeader,
} from '../../domain/services/signature.js';

export type DeliverWebhookResult =
  | 'succeeded'
  | 'failed'
  /** Not waiting for an attempt (already delivered, or unknown). */
  | 'skipped';

/**
 * Makes one attempt of a waiting delivery: signs the envelope with the
 * endpoint's secret (and the previous one while it is valid), POSTs it and records the attempt. A 2xx answer delivers
 * it; anything else marks it failed (retries come later).
 */
@Injectable()
export class DeliverWebhook {
  constructor(
    @Inject(WebhooksTransactionRunner)
    private readonly runner: WebhooksTransactionRunner,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(WebhookSender) private readonly sender: WebhookSender,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
  ) {}

  async execute(deliveryId: string): Promise<DeliverWebhookResult> {
    const repos = this.runner.repositories;
    // The job carries only the delivery id; the row names its Organization.
    const delivery = await repos.deliveries.findById(
      ALL_ORGANIZATIONS,
      deliveryId,
    );
    if (!delivery || delivery.status !== 'PENDING') return 'skipped';
    const scope = organizationScope(delivery.organizationId);
    const endpoint = await repos.endpoints.findById(scope, delivery.endpointId);

    const attemptedAt = this.clock.now();
    let result: DeliveryAttemptResult;
    if (!endpoint || endpoint.status !== 'ENABLED') {
      result = {
        attemptedAt,
        succeeded: false,
        httpStatus: null,
        durationMs: 0,
        responseBody: null,
        error: endpoint
          ? 'The Webhook Endpoint is disabled'
          : 'The Webhook Endpoint was deleted',
      };
    } else {
      const body = JSON.stringify(envelopeOf(delivery));
      // During a secret rotation, one signature per valid secret.
      const previous = validPreviousSecret(endpoint, attemptedAt);
      const secrets = [
        this.cipher.decrypt({
          ciphertext: endpoint.secretCiphertext,
          keyId: endpoint.secretKeyId,
        }),
        ...(previous ? [this.cipher.decrypt(previous)] : []),
      ];
      const outcome = await this.sender.post({
        url: endpoint.url,
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'PayBridge-Webhooks/1.0',
          'paybridge-event-id': delivery.eventId,
          [SIGNATURE_HEADER]: signatureHeader(secrets, attemptedAt, body),
        },
      });
      result = {
        attemptedAt,
        succeeded: outcome.error === null,
        ...outcome,
      };
    }
    await this.runner.run((tx) =>
      tx.deliveries.recordAttempt(scope, delivery.id, newWebhookId(), result),
    );
    return result.succeeded ? 'succeeded' : 'failed';
  }
}
