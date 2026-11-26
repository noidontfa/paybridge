import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';

/**
 * Whether any Payment references a Pricing Plan. Payments live in Payment
 * Core, so the answer comes through its public port; until Payments record
 * their Pricing Plan (ticket 07) none does.
 */
export abstract class PricingPlanPayments {
  abstract anyReference(scope: OrganizationScope, pricingPlanId: string): Promise<boolean>;
}

/** A Pricing Table, as named in a warning. */
export interface PricingTableRef {
  readonly id: string;
  readonly name: string;
}

/**
 * The Pricing Tables that show a Pricing Plan, so archiving it can warn
 * which pages are affected. Empty until Pricing Tables exist (ticket 08).
 */
export abstract class PricingTablesOfPlan {
  abstract including(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<PricingTableRef[]>;
}
