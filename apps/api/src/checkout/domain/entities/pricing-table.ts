import { InvalidPricingTableError } from '../errors.js';
import type { Actor } from './pricing-plan.js';

/** A Pricing Table shows one to three Pricing Plans side by side. */
export const MIN_PLANS = 1;
export const MAX_PLANS = 3;
export const MAX_NAME_LENGTH = 100;
export const MAX_BUTTON_TEXT_LENGTH = 40;

export const PRICING_TABLE_THEMES = ['light', 'dark'] as const;
export const PRICING_TABLE_LANGUAGES = ['vi', 'en'] as const;
export type PricingTableTheme = (typeof PRICING_TABLE_THEMES)[number];
export type PricingTableLanguage = (typeof PRICING_TABLE_LANGUAGES)[number];

/** Everything an Organization Admin sets on a Pricing Table. */
export interface PricingTableTerms {
  readonly name: string;
  /** Pricing Plan ids, in the order the cards are shown. */
  readonly planIds: readonly string[];
  /** One of `planIds`, or none. */
  readonly recommendedPlanId: string | null;
  /** `#rrggbb`, lower case: the only styling a Pricing Table accepts. */
  readonly mainColor: string;
  readonly theme: PricingTableTheme;
  readonly language: PricingTableLanguage;
  readonly buttonText: string;
}

export interface PricingTable extends PricingTableTerms {
  readonly id: string;
  readonly organizationId: string;
  readonly updatedBy: Actor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What the caller sends. */
export interface PricingTableInput {
  readonly name: string;
  readonly planIds: readonly string[];
  readonly recommendedPlanId?: string | null;
  readonly mainColor: string;
  readonly theme: PricingTableTheme;
  readonly language: PricingTableLanguage;
  readonly buttonText: string;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function line(field: string, value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed === '')
    throw new InvalidPricingTableError(field, 'must not be empty');
  if (trimmed.length > max) {
    throw new InvalidPricingTableError(
      field,
      `must be at most ${max} characters`,
    );
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new InvalidPricingTableError(
      field,
      'must be a single line of plain text',
    );
  }
  return trimmed;
}

function plans(ids: readonly string[]): readonly string[] {
  if (ids.length < MIN_PLANS || ids.length > MAX_PLANS) {
    throw new InvalidPricingTableError(
      'planIds',
      `must hold ${MIN_PLANS} to ${MAX_PLANS} Pricing Plans`,
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new InvalidPricingTableError(
      'planIds',
      'must not repeat a Pricing Plan',
    );
  }
  return [...ids];
}

function recommended(
  id: string | null | undefined,
  planIds: readonly string[],
): string | null {
  if (id === undefined || id === null) return null;
  if (!planIds.includes(id)) {
    throw new InvalidPricingTableError(
      'recommendedPlanId',
      'must be one of the Pricing Table’s Pricing Plans',
    );
  }
  return id;
}

function colour(value: string): string {
  if (!HEX_COLOUR.test(value)) {
    throw new InvalidPricingTableError(
      'mainColor',
      'must be a colour like #4f46e5',
    );
  }
  return value.toLowerCase();
}

/**
 * Validates and normalises a Pricing Table: one to three distinct Pricing
 * Plans in order, an optional recommended one among them, a `#rrggbb` main
 * colour and one line of button text. Whether the Pricing Plans exist in the
 * Organization is checked by the use case.
 */
export function definePricingTable(
  input: PricingTableInput,
): PricingTableTerms {
  const planIds = plans(input.planIds);
  return {
    name: line('name', input.name, MAX_NAME_LENGTH),
    planIds,
    recommendedPlanId: recommended(input.recommendedPlanId, planIds),
    mainColor: colour(input.mainColor),
    theme: input.theme,
    language: input.language,
    buttonText: line('buttonText', input.buttonText, MAX_BUTTON_TEXT_LENGTH),
  };
}
