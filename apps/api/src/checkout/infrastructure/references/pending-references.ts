import { Injectable } from '@nestjs/common';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  PricingTablesOfPlan,
  type PricingTableRef,
} from '../../domain/services/pricing-plan-references.js';

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
