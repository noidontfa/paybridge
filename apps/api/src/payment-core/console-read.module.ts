import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import {
  GetCallback,
  ListCallbacks,
} from './application/use-cases/console/callbacks.js';
import {
  GatewaysOverview,
  PUBLIC_BASE_URL,
} from './application/use-cases/console/gateways.js';
import { GetOverview } from './application/use-cases/console/get-overview.js';
import { GetPaymentDetail } from './application/use-cases/console/get-payment-detail.js';
import { GetReviewSummary } from './application/use-cases/console/get-review-summary.js';
import { ListPayments } from './application/use-cases/console/list-payments.js';
import { ListReviews } from './application/use-cases/console/list-reviews.js';
import {
  GetPaymentEvent,
  ListPaymentEvents,
} from './application/use-cases/console/payment-events.js';
import { ListStatusTransitions } from './application/use-cases/console/status-transitions.js';
import { Clock, SystemClock } from './domain/clock.js';
import { CallbacksReadRepository } from './domain/console-read/callbacks-read.repository.js';
import { GatewaysReadRepository } from './domain/console-read/gateways-read.repository.js';
import { OverviewReadRepository } from './domain/console-read/overview-read.repository.js';
import { PaymentDetailReadRepository } from './domain/console-read/payment-detail-read.repository.js';
import { PaymentEventsReadRepository } from './domain/console-read/payment-events-read.repository.js';
import { PaymentsReadRepository } from './domain/console-read/payments-read.repository.js';
import { ReviewsReadRepository } from './domain/console-read/reviews-read.repository.js';
import { StatusTransitionsReadRepository } from './domain/console-read/status-transitions-read.repository.js';
import { CallbacksController } from './infrastructure/http/console/callbacks.controller.js';
import { GatewaysController } from './infrastructure/http/console/gateways.controller.js';
import { OverviewController } from './infrastructure/http/console/overview.controller.js';
import { PaymentDetailController } from './infrastructure/http/console/payment-detail.controller.js';
import { PaymentEventsController } from './infrastructure/http/console/payment-events.controller.js';
import { PaymentsListController } from './infrastructure/http/console/payments-list.controller.js';
import { ReviewsController } from './infrastructure/http/console/reviews.controller.js';
import { StatusTransitionsController } from './infrastructure/http/console/status-transitions.controller.js';
import { PrismaCallbacksReadRepository } from './infrastructure/prisma/console-read/callbacks-read.repository.js';
import { PrismaGatewaysReadRepository } from './infrastructure/prisma/console-read/gateways-read.repository.js';
import { PrismaOverviewReadRepository } from './infrastructure/prisma/console-read/overview-read.repository.js';
import { PrismaPaymentDetailReadRepository } from './infrastructure/prisma/console-read/payment-detail-read.repository.js';
import { PrismaPaymentEventsReadRepository } from './infrastructure/prisma/console-read/payment-events-read.repository.js';
import { PrismaPaymentsReadRepository } from './infrastructure/prisma/console-read/payments-read.repository.js';
import { PrismaReviewsReadRepository } from './infrastructure/prisma/console-read/reviews-read.repository.js';
import { PrismaStatusTransitionsReadRepository } from './infrastructure/prisma/console-read/status-transitions-read.repository.js';

/**
 * The operator read endpoints under `/internal` (ADR 0005), laid out by
 * layer like the rest of Payment Core: controllers and query schemas in
 * `infrastructure/http/console/`, read use cases in `application/use-cases/console/`,
 * the read contracts in `domain/console-read/`, and their queries in
 * `infrastructure/prisma/console-read/`. Needs the global
 * `PrismaModule` and `GatewayManagerModule`.
 */
@Module({
  controllers: [
    PaymentsListController,
    PaymentDetailController,
    ReviewsController,
    OverviewController,
    GatewaysController,
    CallbacksController,
    PaymentEventsController,
    StatusTransitionsController,
  ],
  providers: [
    ListPayments,
    GetPaymentDetail,
    { provide: PaymentsReadRepository, useClass: PrismaPaymentsReadRepository },
    {
      provide: PaymentDetailReadRepository,
      useClass: PrismaPaymentDetailReadRepository,
    },
    ListReviews,
    GetReviewSummary,
    { provide: ReviewsReadRepository, useClass: PrismaReviewsReadRepository },
    GetOverview,
    { provide: OverviewReadRepository, useClass: PrismaOverviewReadRepository },
    { provide: Clock, useClass: SystemClock },
    GatewaysOverview,
    { provide: GatewaysReadRepository, useClass: PrismaGatewaysReadRepository },
    {
      provide: PUBLIC_BASE_URL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('PUBLIC_BASE_URL', { infer: true }),
    },
    ListCallbacks,
    GetCallback,
    {
      provide: CallbacksReadRepository,
      useClass: PrismaCallbacksReadRepository,
    },
    ListPaymentEvents,
    GetPaymentEvent,
    {
      provide: PaymentEventsReadRepository,
      useClass: PrismaPaymentEventsReadRepository,
    },
    ListStatusTransitions,
    {
      provide: StatusTransitionsReadRepository,
      useClass: PrismaStatusTransitionsReadRepository,
    },
  ],
})
export class ConsoleReadModule {}
