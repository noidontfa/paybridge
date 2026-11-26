import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { Clock, SystemClock } from '../domain/clock.js';
import { CallbacksReadRepository } from '../infrastructure/prisma/console-read/callbacks-read.repository.js';
import { GatewaysReadRepository } from '../infrastructure/prisma/console-read/gateways-read.repository.js';
import { OverviewReadRepository } from '../infrastructure/prisma/console-read/overview-read.repository.js';
import { PaymentDetailReadRepository } from '../infrastructure/prisma/console-read/payment-detail-read.repository.js';
import { PaymentEventsReadRepository } from '../infrastructure/prisma/console-read/payment-events-read.repository.js';
import { PaymentsReadRepository } from '../infrastructure/prisma/console-read/payments-read.repository.js';
import { ReviewsReadRepository } from '../infrastructure/prisma/console-read/reviews-read.repository.js';
import { StatusTransitionsReadRepository } from '../infrastructure/prisma/console-read/status-transitions-read.repository.js';
import { CallbacksController } from './callbacks/callbacks.controller.js';
import {
  GatewaysOverview,
  PUBLIC_BASE_URL,
} from './payment-gateways/gateways-overview.js';
import { GatewaysController } from './payment-gateways/gateways.controller.js';
import { GetOverview } from './overview/get-overview.js';
import { OverviewController } from './overview/overview.controller.js';
import { PaymentEventsController } from './payment-events/payment-events.controller.js';
import { PaymentDetailController } from './payments/payment-detail.controller.js';
import { PaymentsListController } from './payments/payments-list.controller.js';
import { ReviewsController } from './reviews/reviews.controller.js';
import { StatusTransitionsController } from './status-transitions/status-transitions.controller.js';

/**
 * The operator read endpoints under `/internal` (ADR 0005): one folder per
 * Console view, each holding its controller and query schema, plus view
 * logic where a view has any (Overview, Payment Gateways).
 * The queries live in `infrastructure/prisma/console-read/`, the only place
 * Core sees the database client. Needs the global `PrismaModule` and
 * `GatewayManagerModule`.
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
    PaymentsReadRepository,
    PaymentDetailReadRepository,
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
    CallbacksReadRepository,
    PaymentEventsReadRepository,
    StatusTransitionsReadRepository,
  ],
})
export class ConsoleReadModule {}
