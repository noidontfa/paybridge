import { Module } from '@nestjs/common';
import { WebhookIntake } from './application/webhook-intake.js';
import { Clock, SystemClock } from './domain/clock.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { WebhooksController } from './http/webhooks.controller.js';

/**
 * Payment Core. Needs `PrismaModule` (global), the config module and the
 * global `GatewayManager` (`GatewayManagerModule.forRoot`).
 * Later tickets register their providers here, keeping each array sorted.
 */
@Module({
  imports: [QueueModule],
  controllers: [WebhooksController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    WebhookIntake,
  ],
  exports: [Clock, QueueModule, TransactionRunner],
})
export class PaymentCoreModule {}
