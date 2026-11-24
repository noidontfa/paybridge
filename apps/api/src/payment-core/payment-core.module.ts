import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PaymentService } from './application/payment.service.js';
import { CreatePayment } from './application/use-cases/create-payment.js';
import { GetPayment } from './application/use-cases/get-payment.js';
import { WebhookIntake } from './application/webhook-intake.js';
import { ExpirePayment } from './application/workers/expire-payment.js';
import { Clock, SystemClock } from './domain/clock.js';
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
  controllers: [PaymentsController, WebhooksController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DomainErrorInterceptor },
    { provide: Clock, useClass: SystemClock },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    expirySweepOptionsProvider,
    outboxRelayOptionsProvider,
    CreatePayment,
    ExpirePayment,
    ExpirySweep,
    ExpirySweepProcessor,
    ExpirySweepScheduler,
    GetPayment,
    OutboxRelay,
    PaymentExpiryProcessor,
    PaymentService,
    WebhookIntake,
  ],
  exports: [Clock, PaymentService, QueueModule, TransactionRunner],
})
export class PaymentCoreModule {}
