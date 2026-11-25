import { Module } from '@nestjs/common';
import { DeveloperViewsModule } from './developer-views.module.js';
import { GatewaysModule } from './gateways.module.js';
import { OverviewModule } from './overview.module.js';
import { PaymentDetailModule } from './payment-detail.module.js';
import { PaymentsListModule } from './payments-list.module.js';
import { ReviewsModule } from './reviews.module.js';

// Operator read endpoints (ADR 0005), one module per endpoint group.
@Module({
  imports: [
    PaymentsListModule,
    PaymentDetailModule,
    ReviewsModule,
    OverviewModule,
    GatewaysModule,
    DeveloperViewsModule,
  ],
})
export class ConsoleReadModule {}
