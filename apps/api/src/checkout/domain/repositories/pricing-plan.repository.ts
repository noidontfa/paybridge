import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type {
  PricingPlan,
  Actor,
  PricingPlanStatus,
  PricingPlanTerms,
} from '../entities/pricing-plan.js';

export interface NewPricingPlan extends PricingPlanTerms {
  readonly id: string;
  readonly updatedBy: Actor;
  readonly at: Date;
}

/**
 * Persistence port for Pricing Plans. Every method takes the Organization
 * scope first (ADR 0006); a plan of another Organization does not exist.
 */
export abstract class PricingPlanRepository {
  abstract create(
    scope: OrganizationScope,
    plan: NewPricingPlan,
  ): Promise<PricingPlan>;
  /** The Organization's Pricing Plans, newest first. */
  abstract list(scope: OrganizationScope): Promise<PricingPlan[]>;
  abstract findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<PricingPlan | null>;
  /** Replaces every field an Organization Admin sets; null when not found. */
  abstract update(
    scope: OrganizationScope,
    id: string,
    terms: PricingPlanTerms,
    by: Actor,
    at: Date,
  ): Promise<PricingPlan | null>;
  abstract setStatus(
    scope: OrganizationScope,
    id: string,
    status: PricingPlanStatus,
    by: Actor,
    at: Date,
  ): Promise<PricingPlan | null>;
  /** False when the Organization has no such Pricing Plan. */
  abstract delete(scope: OrganizationScope, id: string): Promise<boolean>;
}
