import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BestEffortCancel } from './application/best-effort-cancel.js';
import { PaymentService } from './application/payment.service.js';
import { CancelPayment } from './application/use-cases/cancel-payment.js';
import { CreatePayment } from './application/use-cases/create-payment.js';
import { GetPayment } from './application/use-cases/get-payment.js';
import { StartAttempt } from './application/use-cases/start-attempt.js';
import { WebhookIntake } from './application/webhook-intake.js';
import { ExpirePayment } from './application/workers/expire-payment.js';
import { ProcessWebhook } from './application/workers/process-webhook.js';
import { Clock, SystemClock } from './domain/clock.js';
import { AttemptsController } from './http/attempts.controller.js';
import { DomainErrorInterceptor } from './http/domain-error.interceptor.js';
import { PaymentsController } from './http/payments.controller.js';
import { WebhooksController } from './http/webhooks.controller.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { expirySweepOptionsProvider } from './reliability/expiry-sweep.options.js';
import { ExpirySweep } from './reliability/expiry-sweep.js';
import { ExpirySweepScheduler } from './reliability/expiry-sweep.scheduler.js';
import { ExpirySweepProcessor } from './reliability/processors/expiry-sweep.processor.js';
import { PaymentExpiryProcessor } from './reliability/processors/payment-expiry.processor.js';
import { WebhookInboxProcessor } from './reliability/processors/webhook-inbox.processor.js';
import { WebhookInboxSweepProcessor } from './reliability/processors/webhook-inbox-sweep.processor.js';
import { AlertSink, LoggerAlertSink } from './reliability/alert.js';
import { WebhookInboxSweep } from './reliability/webhook-inbox-sweep.js';
import { WebhookInboxSweepScheduler } from './reliability/webhook-inbox-sweep.scheduler.js';
import { RetentionProcessor } from './reliability/processors/retention.processor.js';
import { RetentionCleanup } from './reliability/retention.js';
import { RetentionScheduler } from './reliability/retention.scheduler.js';
import {
  OutboxRelay,
  outboxRelayOptionsProvider,
} from './reliability/outbox-relay.js';

/**
 * Payment Core. Needs `PrismaModule` (global), the config module and the
 * global `GatewayManager` (`GatewayManagerModule.forRoot`).
 * Later tickets register their providers here, keeping each array sorted.
 */
@Module({
  imports: [QueueModule],
  controllers: [AttemptsController, PaymentsController, WebhooksController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DomainErrorInterceptor },
    { provide: AlertSink, useClass: LoggerAlertSink },
    { provide: Clock, useClass: SystemClock },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    expirySweepOptionsProvider,
    outboxRelayOptionsProvider,
    BestEffortCancel,
    CancelPayment,
    CreatePayment,
    ExpirePayment,
    ExpirySweep,
    ExpirySweepProcessor,
    ExpirySweepScheduler,
    GetPayment,
    OutboxRelay,
    PaymentExpiryProcessor,
    PaymentService,
    ProcessWebhook,
    RetentionCleanup,
    RetentionProcessor,
    RetentionScheduler,
    StartAttempt,
    WebhookInboxProcessor,
    WebhookInboxSweep,
    WebhookInboxSweepProcessor,
    WebhookInboxSweepScheduler,
    WebhookIntake,
  ],
  exports: [Clock, PaymentService, QueueModule, TransactionRunner],
})
export class PaymentCoreModule {}
