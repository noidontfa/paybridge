import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveCredentialKeys, type Env } from '../config/env.schema.js';
import { ConnectionPlugins } from './application/connection-plugins.js';
import { ImportEnvStripeAccount } from './application/use-cases/import-env-stripe-account.js';
import {
  ManageGatewayConnections,
  ReencryptGatewayCredentials,
} from './application/use-cases/manage-gateway-connections.js';
import { GatewayConnectionsController } from './infrastructure/http/gateway-connections.controller.js';
import { CredentialCipher } from './domain/services/credential-cipher.js';
import { AesCredentialCipher } from './infrastructure/crypto/credential-cipher.js';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConsoleReadModule } from './console-read.module.js';
import { BestEffortCancel } from './application/best-effort-cancel.js';
import { PaymentService } from './application/payment.service.js';
import { CancelPayment } from './application/use-cases/cancel-payment.js';
import { CreatePayment } from './application/use-cases/create-payment.js';
import { GetPayment } from './application/use-cases/get-payment.js';
import { ResolveReview } from './application/use-cases/resolve-review.js';
import { StartAttempt } from './application/use-cases/start-attempt.js';
import { WebhookIntake } from './application/webhook-intake.js';
import { ExpirePayment } from './application/workers/expire-payment.js';
import { ProcessWebhook } from './application/workers/process-webhook.js';
import { Clock, SystemClock } from './domain/services/clock.js';
import { HandleBrowserReturn } from './application/use-cases/handle-browser-return.js';
import { RequeryAttempt } from './application/workers/requery-attempt.js';
import { AttemptInitiateProcessor } from './infrastructure/queue/processors/attempt-initiate.processor.js';
import { AttemptStatusQueryProcessor } from './infrastructure/queue/processors/attempt-status-query.processor.js';
import { AttemptsController } from './infrastructure/http/attempts.controller.js';
import { BrowserReturnController } from './infrastructure/http/browser-return.controller.js';
import { DomainErrorInterceptor } from './infrastructure/http/domain-error.interceptor.js';
import { PaymentsController } from './infrastructure/http/payments.controller.js';
import { ReviewResolutionController } from './infrastructure/http/review-resolution.controller.js';
import { WebhooksController } from './infrastructure/http/webhooks.controller.js';
import { TransactionRunner } from './domain/repositories/transaction-runner.js';
import { PrismaTransactionRunner } from './infrastructure/prisma/transaction-runner.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { expirySweepOptionsProvider } from './infrastructure/config/expiry-sweep.options.js';
import { ExpirySweep } from './application/sweeps/expiry-sweep.js';
import { ExpirySweepScheduler } from './infrastructure/queue/schedulers/expiry-sweep.scheduler.js';
import { ExpirySweepProcessor } from './infrastructure/queue/processors/expiry-sweep.processor.js';
import { PaymentExpiryProcessor } from './infrastructure/queue/processors/payment-expiry.processor.js';
import { WebhookInboxProcessor } from './infrastructure/queue/processors/webhook-inbox.processor.js';
import { ReviewRequeryProcessor } from './infrastructure/queue/processors/review-requery.processor.js';
import { ReviewRequerySweepProcessor } from './infrastructure/queue/processors/review-requery-sweep.processor.js';
import { ReviewRequerySweep } from './application/sweeps/review-requery-sweep.js';
import { ReviewRequerySweepScheduler } from './infrastructure/queue/schedulers/review-requery-sweep.scheduler.js';
import { WebhookInboxSweepProcessor } from './infrastructure/queue/processors/webhook-inbox-sweep.processor.js';
import { AlertSink } from './domain/services/alert.js';
import { LoggerAlertSink } from './infrastructure/alerting/logger-alert-sink.js';
import { WebhookInboxSweep } from './application/sweeps/webhook-inbox-sweep.js';
import { WebhookInboxSweepScheduler } from './infrastructure/queue/schedulers/webhook-inbox-sweep.scheduler.js';
import { RetentionProcessor } from './infrastructure/queue/processors/retention.processor.js';
import { ProviderQueryRateLimiter } from './application/provider-query-rate-limiter.js';
import { providerQueryRateLimitProvider } from './infrastructure/config/provider-query-rate-limit.options.js';
import { RetentionCleanup } from './application/sweeps/retention.js';
import { RetentionScheduler } from './infrastructure/queue/schedulers/retention.scheduler.js';
import {
  OutboxRelay,
  outboxRelayOptionsProvider,
} from './infrastructure/queue/outbox-relay.js';
import { ListEnabledGateways } from './application/enabled-gateways.js';
import { EnabledGateways } from './port/enabled-gateways.js';

/**
 * Payment Core. Needs `PrismaModule` (global), the config module and the
 * global `GatewayManager` (`GatewayManagerModule.forRoot`).
 * Later tickets register their providers here, keeping each array sorted.
 */
@Module({
  imports: [ConsoleReadModule, QueueModule],
  controllers: [
    AttemptsController,
    BrowserReturnController,
    GatewayConnectionsController,
    PaymentsController,
    ReviewResolutionController,
    WebhooksController,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DomainErrorInterceptor },
    { provide: AlertSink, useClass: LoggerAlertSink },
    { provide: Clock, useClass: SystemClock },
    {
      provide: CredentialCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        AesCredentialCipher.fromConfig(
          resolveCredentialKeys({
            GATEWAY_CREDENTIAL_KEYS: config.get('GATEWAY_CREDENTIAL_KEYS', {
              infer: true,
            }),
          }),
        ),
    },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    expirySweepOptionsProvider,
    outboxRelayOptionsProvider,
    AttemptInitiateProcessor,
    providerQueryRateLimitProvider,
    AttemptStatusQueryProcessor,
    BestEffortCancel,
    CancelPayment,
    ConnectionPlugins,
    CreatePayment,
    { provide: EnabledGateways, useClass: ListEnabledGateways },
    ExpirePayment,
    ExpirySweep,
    ExpirySweepProcessor,
    ExpirySweepScheduler,
    GetPayment,
    HandleBrowserReturn,
    ImportEnvStripeAccount,
    ManageGatewayConnections,
    OutboxRelay,
    PaymentExpiryProcessor,
    PaymentService,
    ProcessWebhook,
    ProviderQueryRateLimiter,
    RetentionCleanup,
    RetentionProcessor,
    ReencryptGatewayCredentials,
    RequeryAttempt,
    ResolveReview,
    RetentionScheduler,
    ReviewRequeryProcessor,
    ReviewRequerySweep,
    ReviewRequerySweepProcessor,
    ReviewRequerySweepScheduler,
    StartAttempt,
    WebhookInboxProcessor,
    WebhookInboxSweep,
    WebhookInboxSweepProcessor,
    WebhookInboxSweepScheduler,
    WebhookIntake,
  ],
  exports: [
    Clock,
    CredentialCipher,
    EnabledGateways,
    PaymentService,
    ImportEnvStripeAccount,
    QueueModule,
    ReencryptGatewayCredentials,
    TransactionRunner,
  ],
})
export class PaymentCoreModule {}
