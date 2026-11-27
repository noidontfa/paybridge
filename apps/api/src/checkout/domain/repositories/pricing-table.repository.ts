import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type { Actor } from '../entities/pricing-plan.js';
import type {
  PricingTable,
  PricingTableTerms,
} from '../entities/pricing-table.js';
import type { PricingTableRef } from '../services/pricing-plan-references.js';

export interface NewPricingTable extends PricingTableTerms {
  readonly id: string;
  readonly updatedBy: Actor;
  readonly at: Date;
}

/**
 * Persistence port for Pricing Tables and the Pricing Plans they show. Every
 * method takes the Organization scope first (ADR 0006); a table of another
 * Organization does not exist. Writes that touch several rows run inside
 * `TransactionRunner.run`.
 */
export abstract class PricingTableRepository {
  abstract create(
    scope: OrganizationScope,
    table: NewPricingTable,
  ): Promise<PricingTable>;
  /** The Organization's Pricing Tables, newest first. */
  abstract list(scope: OrganizationScope): Promise<PricingTable[]>;
  abstract findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<PricingTable | null>;
  /** Replaces every field and the Pricing Plans; null when not found. */
  abstract update(
    scope: OrganizationScope,
    id: string,
    terms: PricingTableTerms,
    by: Actor,
    at: Date,
  ): Promise<PricingTable | null>;
  /** False when the Organization has no such Pricing Table. */
  abstract delete(scope: OrganizationScope, id: string): Promise<boolean>;
  /** The Pricing Tables that show a Pricing Plan, by name. */
  abstract including(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<PricingTableRef[]>;
}
