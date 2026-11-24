import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PaymentService } from './application/payment.service.js';
import { CreatePayment } from './application/use-cases/create-payment.js';
import { Clock, SystemClock } from './domain/clock.js';
import { DomainErrorInterceptor } from './http/domain-error.interceptor.js';
import { PaymentsController } from './http/payments.controller.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';

/**
 * Payment Core. Needs `PrismaModule` (global) and the config module.
 * Later tickets register their providers here, keeping each array sorted,
 * one entry per line.
 */
@Module({
  imports: [QueueModule],
  controllers: [PaymentsController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DomainErrorInterceptor },
    { provide: Clock, useClass: SystemClock },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    CreatePayment,
    PaymentService,
  ],
  exports: [Clock, PaymentService, QueueModule, TransactionRunner],
})
export class PaymentCoreModule {}
