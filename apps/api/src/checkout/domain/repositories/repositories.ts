import type { CheckoutSessionRepository } from './checkout-session.repository.js';
import type { PricingPlanRepository } from './pricing-plan.repository.js';

/** Every checkout repository, bound to one database handle. */
export interface Repositories {
  readonly pricingPlans: PricingPlanRepository;
  readonly checkoutSessions: CheckoutSessionRepository;
}
