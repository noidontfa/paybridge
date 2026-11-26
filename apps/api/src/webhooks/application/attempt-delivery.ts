import { Inject, Injectable } from '@nestjs/common';
import {
  envelopeOf,
  type DeliveryAttemptResult,
  type WebhookDelivery,
} from '../domain/entities/webhook-delivery.js';
import type { WebhookEndpoint } from '../domain/entities/webhook-endpoint.js';
import {
  SecretCipher,
  WebhooksClock,
  WebhookSender,
} from '../domain/services/ports.js';
import {
  SIGNATURE_HEADER,
  signatureHeader,
} from '../domain/services/signature.js';

/**
 * One signed POST of a delivery to its endpoint, as a User asked for it
 * (resend or test send). Like the delivery worker, it never throws for a
 * failed delivery: the result says what happened.
 */
@Injectable()
export class AttemptDelivery {
  constructor(
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(WebhookSender) private readonly sender: WebhookSender,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
  ) {}

  /** `endpoint` is null when it was deleted; nothing is sent then. */
  async execute(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint | null,
  ): Promise<DeliveryAttemptResult> {
    const attemptedAt = this.clock.now();
    if (!endpoint) {
      return refused(attemptedAt, 'The Webhook Endpoint was deleted');
    }
    const body = JSON.stringify(envelopeOf(delivery));
    const secret = this.cipher.decrypt({
      ciphertext: endpoint.secretCiphertext,
      keyId: endpoint.secretKeyId,
    });
    const outcome = await this.sender.post({
      url: endpoint.url,
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'PayBridge-Webhooks/1.0',
        'paybridge-event-id': delivery.eventId,
        [SIGNATURE_HEADER]: signatureHeader([secret], attemptedAt, body),
      },
    });
    return { attemptedAt, succeeded: outcome.error === null, ...outcome };
  }
}

export function refused(attemptedAt: Date, error: string): DeliveryAttemptResult {
  return {
    attemptedAt,
    succeeded: false,
    httpStatus: null,
    durationMs: 0,
    responseBody: null,
    error,
  };
}
