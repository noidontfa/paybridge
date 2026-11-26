import type { PricingPlanRepository } from './pricing-plan.repository.js';
import type { PricingTableRepository } from './pricing-table.repository.js';

/** Every checkout repository, bound to one database handle. */
export interface Repositories {
  readonly pricingPlans: PricingPlanRepository;
  readonly pricingTables: PricingTableRepository;
}
