import { Inject, Injectable } from '@nestjs/common';
import { newCheckoutId } from '../../domain/ids.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  definePricingPlanTerms,
  type PricingPlan,
  type PricingPlanEditor,
  type PricingPlanInput,
  type PricingPlanStatus,
} from '../../domain/entities/pricing-plan.js';
import {
  PricingPlanInUseError,
  PricingPlanNotFoundError,
} from '../../domain/errors.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { CheckoutClock } from '../../domain/services/clock.js';
import { CheckoutSettings } from '../../domain/services/checkout-settings.js';
import {
  PricingPlanPayments,
  PricingTablesOfPlan,
  type PricingTableRef,
} from '../../domain/services/pricing-plan-references.js';

/** A Pricing Plan with the Pricing Tables that show it. */
export interface PricingPlanDetail {
  readonly plan: PricingPlan;
  readonly pricingTables: PricingTableRef[];
}

/**
 * Pricing Plan management for the Console: every query and write is scoped
 * to the caller's Organization (ADR 0006).
 */
@Injectable()
export class ManagePricingPlans {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CheckoutClock) private readonly clock: CheckoutClock,
    @Inject(CheckoutSettings) private readonly settings: CheckoutSettings,
    @Inject(PricingPlanPayments) private readonly payments: PricingPlanPayments,
    @Inject(PricingTablesOfPlan) private readonly tables: PricingTablesOfPlan,
  ) {}

  private get plans() {
    return this.runner.repositories.pricingPlans;
  }

  create(
    scope: OrganizationScope,
    input: PricingPlanInput,
    by: PricingPlanEditor,
  ): Promise<PricingPlan> {
    const terms = definePricingPlanTerms(input, this.settings);
    return this.plans.create(scope, {
      ...terms,
      id: newCheckoutId(),
      updatedBy: by,
      at: this.clock.now(),
    });
  }

  list(scope: OrganizationScope): Promise<PricingPlan[]> {
    return this.plans.list(scope);
  }

  async get(scope: OrganizationScope, id: string): Promise<PricingPlanDetail> {
    const plan = await this.plans.findById(scope, id);
    if (!plan) throw new PricingPlanNotFoundError(id);
    return { plan, pricingTables: await this.tables.including(scope, id) };
  }

  /** Replaces every field; allowed in any status. */
  async update(
    scope: OrganizationScope,
    id: string,
    input: PricingPlanInput,
    by: PricingPlanEditor,
  ): Promise<PricingPlan> {
    const terms = definePricingPlanTerms(input, this.settings);
    const plan = await this.plans.update(scope, id, terms, by, this.clock.now());
    if (!plan) throw new PricingPlanNotFoundError(id);
    return plan;
  }

  /**
   * Archives a Pricing Plan so it can no longer be bought; its Payments keep
   * their history. Returns the Pricing Tables that still show it.
   */
  archive(
    scope: OrganizationScope,
    id: string,
    by: PricingPlanEditor,
  ): Promise<PricingPlanDetail> {
    return this.setStatus(scope, id, 'ARCHIVED', by);
  }

  restore(
    scope: OrganizationScope,
    id: string,
    by: PricingPlanEditor,
  ): Promise<PricingPlanDetail> {
    return this.setStatus(scope, id, 'ACTIVE', by);
  }

  /** Deletes a Pricing Plan no Payment references; otherwise it must be archived. */
  async delete(scope: OrganizationScope, id: string): Promise<void> {
    if (!(await this.plans.findById(scope, id))) {
      throw new PricingPlanNotFoundError(id);
    }
    if (await this.payments.anyReference(scope, id)) {
      throw new PricingPlanInUseError(id);
    }
    if (!(await this.plans.delete(scope, id))) {
      throw new PricingPlanNotFoundError(id);
    }
  }

  private async setStatus(
    scope: OrganizationScope,
    id: string,
    status: PricingPlanStatus,
    by: PricingPlanEditor,
  ): Promise<PricingPlanDetail> {
    const plan = await this.plans.setStatus(
      scope,
      id,
      status,
      by,
      this.clock.now(),
    );
    if (!plan) throw new PricingPlanNotFoundError(id);
    return { plan, pricingTables: await this.tables.including(scope, id) };
  }
}
