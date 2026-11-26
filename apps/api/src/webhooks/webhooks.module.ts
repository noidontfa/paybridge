import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveCredentialKeys, type Env } from '../config/env.schema.js';
import { AesCredentialCipher } from '../payment-core/port/credential-cipher.js';
import { ManageWebhookEndpoints } from './application/use-cases/webhook-endpoints.js';
import { WebhookDeliverySweep } from './application/sweeps/webhook-delivery-sweep.js';
import {
  WEBHOOK_RETENTION_OPTIONS,
  WebhookRetention,
  type WebhookRetentionOptions,
} from './application/sweeps/webhook-retention.js';
import { DeliverWebhook } from './application/workers/deliver-webhook.js';
import { FanOutPaymentEvent } from './application/workers/fan-out-payment-event.js';
import { WebhooksTransactionRunner } from './domain/repositories/transaction-runner.js';
import {
  DeliveryDispatcher,
  MathRetryJitter,
  RetryJitter,
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
  WebhookMaintenanceProcessor,
  WebhookMaintenanceScheduler,
} from './infrastructure/queue/maintenance.js';
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
    { provide: RetryJitter, useClass: MathRetryJitter },
    {
      provide: WEBHOOK_RETENTION_OPTIONS,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Env, true>,
      ): WebhookRetentionOptions => ({
        deliveryRetentionMs:
          config.get('WEBHOOK_DELIVERY_RETENTION_DAYS', { infer: true }) *
          24 *
          60 *
          60 *
          1000,
      }),
    },
    WebhookDeliverySweep,
    WebhookRetention,
    WebhookMaintenanceScheduler,
    WebhookMaintenanceProcessor,
    DeliverWebhook,
    FanOutPaymentEvent,
    ManageWebhookEndpoints,
    PaymentEventProcessor,
    WebhookDeliveryProcessor,
  ],
})
export class WebhooksModule {}
