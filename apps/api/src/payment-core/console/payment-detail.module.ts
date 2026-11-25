import { Module } from '@nestjs/common';
import { GetPaymentDetail } from '../application/use-cases/console/get-payment-detail.js';
import { PaymentDetailReadRepository } from '../infrastructure/prisma/console-read/payment-detail-read.repository.js';
import { PaymentDetailController } from '../http/console/payment-detail.controller.js';

/** `GET /internal/payments/:id`. Needs the global `PrismaModule`. */
@Module({
  controllers: [PaymentDetailController],
  providers: [GetPaymentDetail, PaymentDetailReadRepository],
})
export class PaymentDetailModule {}
