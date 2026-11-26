import { Inject, Injectable } from '@nestjs/common';
import { CheckoutPayments } from '../../../payment-core/port/payments.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type {
  PricingPlan,
  PricingPlanEditor,
  PricingPlanFeature,
} from '../../domain/entities/pricing-plan.js';
import {
  definePricingTable,
  type PricingTable,
  type PricingTableInput,
  type PricingTableLanguage,
  type PricingTableTerms,
  type PricingTableTheme,
} from '../../domain/entities/pricing-table.js';
import {
  CheckoutUnavailableError,
  PricingPlanNotFoundError,
  PricingTableNotFoundError,
  type UnavailableReason,
} from '../../domain/errors.js';
import { newCheckoutId } from '../../domain/ids.js';
import type { Repositories } from '../../domain/repositories/repositories.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { CheckoutClock } from '../../domain/services/clock.js';
import {
  PricingTablesOfPlan,
  type PricingTableRef,
} from '../../domain/services/pricing-plan-references.js';
import { sellableGatewayIds } from '../../domain/services/sellable-gateways.js';

/** Another Organization's Pricing Plan behaves as if it did not exist. */
async function requirePlans(
  repos: Repositories,
  scope: OrganizationScope,
  terms: PricingTableTerms,
): Promise<void> {
  for (const id of terms.planIds) {
    if (!(await repos.pricingPlans.findById(scope, id))) {
      throw new PricingPlanNotFoundError(id);
    }
  }
}

/**
 * Pricing Table management for the Console: every query and write is scoped
 * to the caller's Organization (ADR 0006).
 */
@Injectable()
export class ManagePricingTables {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CheckoutClock) private readonly clock: CheckoutClock,
  ) {}

  create(
    scope: OrganizationScope,
    input: PricingTableInput,
    by: PricingPlanEditor,
  ): Promise<PricingTable> {
    const terms = definePricingTable(input);
    return this.runner.run(async (repos) => {
      await requirePlans(repos, scope, terms);
      return repos.pricingTables.create(scope, {
        ...terms,
        id: newCheckoutId(),
        updatedBy: by,
        at: this.clock.now(),
      });
    });
  }

  list(scope: OrganizationScope): Promise<PricingTable[]> {
    return this.runner.repositories.pricingTables.list(scope);
  }

  async get(scope: OrganizationScope, id: string): Promise<PricingTable> {
    const table = await this.runner.repositories.pricingTables.findById(scope, id);
    if (!table) throw new PricingTableNotFoundError(id);
    return table;
  }

  /** Replaces every field, Pricing Plans included. */
  update(
    scope: OrganizationScope,
    id: string,
    input: PricingTableInput,
    by: PricingPlanEditor,
  ): Promise<PricingTable> {
    const terms = definePricingTable(input);
    return this.runner.run(async (repos) => {
      if (!(await repos.pricingTables.findById(scope, id))) {
        throw new PricingTableNotFoundError(id);
      }
      await requirePlans(repos, scope, terms);
      const table = await repos.pricingTables.update(
        scope,
        id,
        terms,
        by,
        this.clock.now(),
      );
      if (!table) throw new PricingTableNotFoundError(id);
      return table;
    });
  }

  /** Deletes outright; pages that still embed it show "unavailable". */
  async delete(scope: OrganizationScope, id: string): Promise<void> {
    const deleted = await this.runner.run((repos) =>
      repos.pricingTables.delete(scope, id),
    );
    if (!deleted) throw new PricingTableNotFoundError(id);
  }
}

/** The Pricing Tables that show a Pricing Plan (05's archive warning). */
@Injectable()
export class PricingTablesIncludingPlan extends PricingTablesOfPlan {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {
    super();
  }

  including(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<PricingTableRef[]> {
    return this.runner.repositories.pricingTables.including(scope, pricingPlanId);
  }
}

/** Why a card cannot be bought, for the developer console only. */
export type PlanUnavailableReason = Extract<
  UnavailableReason,
  'PRICING_PLAN_ARCHIVED' | 'NO_GATEWAY_AVAILABLE'
>;

/** One card of a Pricing Table as a host page shows it. */
export interface PricingTableCard {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly features: readonly PricingPlanFeature[];
  readonly amount: string;
  readonly currency: string;
  readonly recommended: boolean;
  /** Allowed by the Pricing Plan and enabled for the Organization. */
  readonly gatewayIds: readonly string[];
  readonly buyable: boolean;
  readonly unavailableReason: PlanUnavailableReason | null;
}

/** What the SDK draws on a host page. */
export interface PricingTableDisplay {
  readonly id: string;
  readonly mainColor: string;
  readonly theme: PricingTableTheme;
  readonly language: PricingTableLanguage;
  readonly buttonText: string;
  readonly cards: readonly PricingTableCard[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function card(
  plan: PricingPlan,
  recommendedPlanId: string | null,
  enabled: readonly string[],
): PricingTableCard {
  const gatewayIds = sellableGatewayIds(plan, enabled);
  const unavailableReason: PlanUnavailableReason | null =
    plan.status !== 'ACTIVE'
      ? 'PRICING_PLAN_ARCHIVED'
      : gatewayIds.length === 0
        ? 'NO_GATEWAY_AVAILABLE'
        : null;
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    features: plan.features,
    amount: plan.amount,
    currency: plan.currency,
    recommended: plan.id === recommendedPlanId,
    gatewayIds,
    buyable: unavailableReason === null,
    unavailableReason,
  };
}

/**
 * The public read behind a Publishable Key: a Pricing Table of the key's
 * Organization with its Pricing Plans as cards. Archived Pricing Plans keep
 * their column, marked not buyable.
 */
@Injectable()
export class ShowPricingTable {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CheckoutPayments) private readonly payments: CheckoutPayments,
  ) {}

  async execute(
    scope: OrganizationScope,
    id: string,
  ): Promise<PricingTableDisplay> {
    const repos = this.runner.repositories;
    const table = UUID.test(id)
      ? await repos.pricingTables.findById(scope, id)
      : null;
    if (!table) throw new CheckoutUnavailableError('PRICING_TABLE_NOT_FOUND');
    const enabled = await this.payments.enabledGatewayIds(scope);
    const cards: PricingTableCard[] = [];
    for (const planId of table.planIds) {
      const plan = await repos.pricingPlans.findById(scope, planId);
      // The foreign key keeps every Pricing Plan of a table in place.
      if (plan) cards.push(card(plan, table.recommendedPlanId, enabled));
    }
    return {
      id: table.id,
      mainColor: table.mainColor,
      theme: table.theme,
      language: table.language,
      buttonText: table.buttonText,
      cards,
    };
  }
}
