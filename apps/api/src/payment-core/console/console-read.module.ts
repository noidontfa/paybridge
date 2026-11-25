import { Module } from '@nestjs/common';
import { PaymentsListModule } from './payments-list.module.js';

// Operator read endpoints (ADR 0005), one module per endpoint group.
//
// Adding a group (tickets 03 to 07): create `<group>.module.ts` next to this
// file, then replace YOUR placeholder line in the imports and in the array
// below. The placeholders are separated by blank lines on purpose: parallel
// branches then edit lines that are not adjacent, so they merge without
// conflicts. Do not reorder, reflow or delete other lines.

import { PaymentDetailModule } from './payment-detail.module.js';

import { ReviewsModule } from './reviews.module.js';

// ticket 05: OverviewModule

// ticket 06: GatewaysModule

// ticket 07: DeveloperViewsModule

@Module({
  imports: [
    PaymentsListModule,

    PaymentDetailModule,

    ReviewsModule,

    // ticket 05

    // ticket 06

    // ticket 07
  ],
})
export class ConsoleReadModule {}
