import type { PricingPlanRules } from '../entities/pricing-plan.js';

/** Deployment settings the checkout rules depend on, from configuration. */
export abstract class CheckoutSettings implements PricingPlanRules {
  /** Plain-HTTP return URLs are accepted only in development. */
  abstract readonly allowInsecureUrls: boolean;
}
