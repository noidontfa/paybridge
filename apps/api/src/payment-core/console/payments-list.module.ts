import { Module } from '@nestjs/common';
import { ListPayments } from '../application/use-cases/console/list-payments.js';
import { PaymentsReadRepository } from '../infrastructure/prisma/console-read/payments-read.repository.js';
import { PaymentsListController } from '../http/console/payments-list.controller.js';

/** `GET /internal/payments`. Needs the global `PrismaModule`. */
@Module({
  controllers: [PaymentsListController],
  providers: [ListPayments, PaymentsReadRepository],
})
export class PaymentsListModule {}
