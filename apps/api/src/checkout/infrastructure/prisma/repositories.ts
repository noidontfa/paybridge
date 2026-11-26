import type { Repositories } from '../../domain/repositories/repositories.js';
import type { DbContext } from './db.js';
import { PrismaPricingPlanRepository } from './pricing-plan.repository.js';
import { PrismaPricingTableRepository } from './pricing-table.repository.js';

/** Every Prisma repository, bound to one database handle. Add new ones here. */
export function createRepositories(ctx: DbContext): Repositories {
  return {
    pricingPlans: new PrismaPricingPlanRepository(ctx),
    pricingTables: new PrismaPricingTableRepository(ctx),
  };
}
