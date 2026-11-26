import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveCredentialKeys, type Env } from '../config/env.schema.js';
import { AesCredentialCipher } from '../payment-core/port/credential-cipher.js';
import { ManageWebhookEndpoints } from './application/use-cases/webhook-endpoints.js';
import { DeliverWebhook } from './application/workers/deliver-webhook.js';
import { FanOutPaymentEvent } from './application/workers/fan-out-payment-event.js';
import { WebhooksTransactionRunner } from './domain/repositories/transaction-runner.js';
import {
  DeliveryDispatcher,
  SecretCipher,
  SystemWebhooksClock,
  WebhooksClock,
  WebhookSender,
  WebhookUrlGuard,
} from './domain/services/ports.js';
import { webhookDeliveryOptionsProvider } from './infrastructure/config/delivery-options.js';
import {
  HttpWebhookSender,
  PolicyWebhookUrlGuard,
} from './infrastructure/delivery/http-webhook-sender.js';
import { WebhookEndpointsController } from './infrastructure/http/webhook-endpoints.controller.js';
import { PrismaWebhooksTransactionRunner } from './infrastructure/prisma/transaction-runner.js';
import {
  PaymentEventProcessor,
  WebhookDeliveryProcessor,
} from './infrastructure/queue/processors.js';
import {
  BullDeliveryDispatcher,
  WEBHOOK_QUEUES,
} from './infrastructure/queue/webhook-queues.js';

/**
 * Webhooks (`wh_` tables): Webhook Endpoints, and the signed delivery of every
 * Payment Event to them. It consumes Core's `core-outbox` queue; Payment Core
 * does not know it exists. Needs the global `PrismaModule` and the BullMQ
 * connection Payment Core configures.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      ...Object.values(WEBHOOK_QUEUES).map((name) => ({ name })),
    ),
  ],
  controllers: [WebhookEndpointsController],
  providers: [
    {
      provide: WebhooksTransactionRunner,
      useClass: PrismaWebhooksTransactionRunner,
    },
    { provide: WebhooksClock, useClass: SystemWebhooksClock },
    { provide: DeliveryDispatcher, useClass: BullDeliveryDispatcher },
    { provide: WebhookSender, useClass: HttpWebhookSender },
    { provide: WebhookUrlGuard, useClass: PolicyWebhookUrlGuard },
    {
      // Signing secrets are sealed with the same rotating keys as Gateway
      // Connection credentials.
      provide: SecretCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SecretCipher =>
        AesCredentialCipher.fromConfig(
          resolveCredentialKeys({
            GATEWAY_CREDENTIAL_KEYS: config.get('GATEWAY_CREDENTIAL_KEYS', {
              infer: true,
            }),
          }),
        ),
    },
    webhookDeliveryOptionsProvider,
    DeliverWebhook,
    FanOutPaymentEvent,
    ManageWebhookEndpoints,
    PaymentEventProcessor,
    WebhookDeliveryProcessor,
  ],
})
export class WebhooksModule {}
