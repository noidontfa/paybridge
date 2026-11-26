import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { ManagePricingPlans } from './application/use-cases/pricing-plans.js';
import { TransactionRunner } from './domain/repositories/transaction-runner.js';
import { CheckoutSettings } from './domain/services/checkout-settings.js';
import { CheckoutClock, SystemCheckoutClock } from './domain/services/clock.js';
import {
  PricingPlanPayments,
  PricingTablesOfPlan,
} from './domain/services/pricing-plan-references.js';
import { PricingPlansController } from './infrastructure/http/pricing-plans.controller.js';
import { PrismaTransactionRunner } from './infrastructure/prisma/transaction-runner.js';
import { NoPricingTablesYet } from './infrastructure/references/pending-references.js';
import { PaymentCoreModule } from '../payment-core/port/payments.js';
import { checkoutPaymentsProviders } from './infrastructure/checkout-payments.providers.js';
import { CheckoutPaymentsController } from './infrastructure/http/checkout-payments.controller.js';
import { CorePricingPlanPayments } from './infrastructure/references/core-pricing-plan-payments.js';

/**
 * Checkout: Pricing Plans (and later Pricing Tables and the public checkout
 * endpoints), in `chk_` tables. It reaches Payment Core and identity only
 * through their `port/` folders. Needs the global `PrismaModule`.
 */
@Module({
  imports: [PaymentCoreModule],
  controllers: [PricingPlansController, CheckoutPaymentsController],
  providers: [
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    { provide: CheckoutClock, useClass: SystemCheckoutClock },
    {
      provide: CheckoutSettings,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CheckoutSettings => ({
        allowInsecureUrls:
          config.get('NODE_ENV', { infer: true }) === 'development',
      }),
    },
    { provide: PricingPlanPayments, useClass: CorePricingPlanPayments },
    { provide: PricingTablesOfPlan, useClass: NoPricingTablesYet },
    ManagePricingPlans,
    ...checkoutPaymentsProviders,
  ],
})
export class CheckoutModule {}
