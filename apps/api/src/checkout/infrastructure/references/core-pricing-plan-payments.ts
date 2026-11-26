import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import { CheckoutPayments } from '../../../payment-core/port/payments.js';
import { PricingPlanPayments } from '../../domain/services/pricing-plan-references.js';

/** Asks Payment Core whether any Payment records the Pricing Plan. */
@Injectable()
export class CorePricingPlanPayments extends PricingPlanPayments {
  constructor(
    @Inject(CheckoutPayments) private readonly payments: CheckoutPayments,
  ) {
    super();
  }

  anyReference(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<boolean> {
    return this.payments.anyForPricingPlan(scope, pricingPlanId);
  }
}
