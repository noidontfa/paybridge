import { Inject, Injectable } from '@nestjs/common';
import {
  envelopeOf,
  type DeliveryAttemptResult,
  type WebhookDelivery,
} from '../domain/entities/webhook-delivery.js';
import {
  validPreviousSecret,
  type WebhookEndpoint,
} from '../domain/entities/webhook-endpoint.js';
import { SecretCipher, WebhookSender } from '../domain/services/ports.js';
import {
  SIGNATURE_HEADER,
  signatureHeader,
} from '../domain/services/signature.js';

/**
 * One signed POST of a delivery to its endpoint. Every attempt goes through
 * here: automatic ones (first try and retries), resends and test sends. It
 * never throws for a failed delivery: the result says what happened.
 */
@Injectable()
export class AttemptDelivery {
  constructor(
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(WebhookSender) private readonly sender: WebhookSender,
  ) {}

  async post(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
    attemptedAt: Date,
  ): Promise<DeliveryAttemptResult> {
    const body = JSON.stringify(envelopeOf(delivery));
    // During a secret rotation, one signature per secret valid at this attempt.
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
    return { attemptedAt, succeeded: outcome.error === null, ...outcome };
  }
}

/** An attempt that sent nothing, and why. */
export function refused(
  attemptedAt: Date,
  error: string,
): DeliveryAttemptResult {
  return {
    attemptedAt,
    succeeded: false,
    httpStatus: null,
    durationMs: 0,
    responseBody: null,
    error,
  };
}
