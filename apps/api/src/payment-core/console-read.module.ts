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
import { CallbacksController } from './http/console/callbacks.controller.js';
import { GatewaysController } from './http/console/gateways.controller.js';
import { OverviewController } from './http/console/overview.controller.js';
import { PaymentDetailController } from './http/console/payment-detail.controller.js';
import { PaymentEventsController } from './http/console/payment-events.controller.js';
import { PaymentsListController } from './http/console/payments-list.controller.js';
import { ReviewsController } from './http/console/reviews.controller.js';
import { StatusTransitionsController } from './http/console/status-transitions.controller.js';
import { CallbacksReadRepository } from './infrastructure/prisma/console-read/callbacks-read.repository.js';
import { GatewaysReadRepository } from './infrastructure/prisma/console-read/gateways-read.repository.js';
import { OverviewReadRepository } from './infrastructure/prisma/console-read/overview-read.repository.js';
import { PaymentDetailReadRepository } from './infrastructure/prisma/console-read/payment-detail-read.repository.js';
import { PaymentEventsReadRepository } from './infrastructure/prisma/console-read/payment-events-read.repository.js';
import { PaymentsReadRepository } from './infrastructure/prisma/console-read/payments-read.repository.js';
import { ReviewsReadRepository } from './infrastructure/prisma/console-read/reviews-read.repository.js';
import { StatusTransitionsReadRepository } from './infrastructure/prisma/console-read/status-transitions-read.repository.js';

/**
 * The operator read endpoints under `/internal` (ADR 0005), laid out by
 * layer like the rest of Payment Core: controllers and query schemas in
 * `http/console/`, read use cases in `application/use-cases/console/`, and
 * queries in `infrastructure/prisma/console-read/`. Needs the global
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
    PaymentsReadRepository,
    PaymentDetailReadRepository,
    ListReviews,
    GetReviewSummary,
    ReviewsReadRepository,
    GetOverview,
    OverviewReadRepository,
    { provide: Clock, useClass: SystemClock },
    GatewaysOverview,
    GatewaysReadRepository,
    {
      provide: PUBLIC_BASE_URL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('PUBLIC_BASE_URL', { infer: true }),
    },
    ListCallbacks,
    GetCallback,
    CallbacksReadRepository,
    ListPaymentEvents,
    GetPaymentEvent,
    PaymentEventsReadRepository,
    ListStatusTransitions,
    StatusTransitionsReadRepository,
  ],
})
export class ConsoleReadModule {}
