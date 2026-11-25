import { Module } from '@nestjs/common';
import {
  GetCallback,
  ListCallbacks,
} from '../application/use-cases/console/callbacks.js';
import {
  GetPaymentEvent,
  ListPaymentEvents,
} from '../application/use-cases/console/payment-events.js';
import { ListStatusTransitions } from '../application/use-cases/console/status-transitions.js';
import { CallbacksController } from '../http/console/callbacks.controller.js';
import { PaymentEventsController } from '../http/console/payment-events.controller.js';
import { StatusTransitionsController } from '../http/console/status-transitions.controller.js';
import { CallbacksReadRepository } from '../infrastructure/prisma/console-read/callbacks-read.repository.js';
import { PaymentEventsReadRepository } from '../infrastructure/prisma/console-read/payment-events-read.repository.js';
import { StatusTransitionsReadRepository } from '../infrastructure/prisma/console-read/status-transitions-read.repository.js';

/**
 * `GET /internal/callbacks[/:id]`, `/internal/payment-events[/:id]` and
 * `/internal/status-transitions`: the Developers pages. Needs the global
 * `PrismaModule`.
 */
@Module({
  controllers: [
    CallbacksController,
    PaymentEventsController,
    StatusTransitionsController,
  ],
  providers: [
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
export class DeveloperViewsModule {}
