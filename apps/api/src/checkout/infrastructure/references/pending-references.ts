import { Injectable } from '@nestjs/common';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  PricingPlanPayments,
  PricingTablesOfPlan,
  type PricingTableRef,
} from '../../domain/services/pricing-plan-references.js';

/**
 * No Payment records its Pricing Plan yet. Ticket 07 replaces this with a
 * lookup through Payment Core's public port.
 */
@Injectable()
export class NoPricingPlanPaymentsYet extends PricingPlanPayments {
  anyReference(_scope: OrganizationScope, _pricingPlanId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** Pricing Tables do not exist yet. Ticket 08 replaces this with its repository. */
@Injectable()
export class NoPricingTablesYet extends PricingTablesOfPlan {
  including(
    _scope: OrganizationScope,
    _pricingPlanId: string,
  ): Promise<PricingTableRef[]> {
    return Promise.resolve([]);
  }
}
