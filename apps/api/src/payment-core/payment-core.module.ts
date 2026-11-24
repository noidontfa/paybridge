import { Module } from '@nestjs/common';
import { Clock, SystemClock } from './domain/clock.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';

/**
 * Payment Core. Needs `PrismaModule` (global) and the config module.
 * Later tickets register their providers here, keeping each array sorted.
 */
@Module({
  imports: [QueueModule],
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
  ],
  exports: [Clock, QueueModule, TransactionRunner],
})
export class PaymentCoreModule {}
