import {
  DEFAULT_PAYMENT_EXPIRY_MS,
  InvalidAmountError,
  MAX_PAYMENT_EXPIRY_MS,
  MIN_PAYMENT_EXPIRY_MS,
  parseAmount,
} from '../../../payment-core/port/payment-terms.js';
import { InvalidPricingPlanError } from '../errors.js';

/** Pricing Plans are sold in VND only for now. */
export const PRICING_PLAN_CURRENCY = 'VND';

export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
/** "About ten" feature lines: enough for a price card, short enough to compare. */
export const MAX_FEATURES = 10;
export const MAX_FEATURE_LENGTH = 200;
export const MAX_ALLOWED_GATEWAYS = 20;

const MINUTE_MS = 60_000;
/** Payment Expiry bounds in minutes, the same range Payment Core enforces. */
export const MIN_EXPIRY_MINUTES = MIN_PAYMENT_EXPIRY_MS / MINUTE_MS;
export const MAX_EXPIRY_MINUTES = MAX_PAYMENT_EXPIRY_MS / MINUTE_MS;
export const DEFAULT_EXPIRY_MINUTES = DEFAULT_PAYMENT_EXPIRY_MS / MINUTE_MS;

export type PricingPlanStatus = 'ACTIVE' | 'ARCHIVED';

/** One line on a price card: plain text, never rendered as HTML. */
export interface PricingPlanFeature {
  readonly text: string;
  readonly included: boolean;
}

/** Who last changed a Pricing Plan, as they were at that moment. */
export interface PricingPlanEditor {
  readonly userId: string;
  readonly role: string;
  readonly name: string;
}

/** Everything an Organization Admin sets on a Pricing Plan. */
export interface PricingPlanTerms {
  readonly name: string;
  readonly description: string;
  readonly features: readonly PricingPlanFeature[];
  /** A decimal string in the major unit (whole dong). */
  readonly amount: string;
  readonly currency: string;
  /** Empty means every PaymentGateway the Organization has enabled. */
  readonly allowedGatewayIds: readonly string[];
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
  readonly expiryMinutes: number;
}

export interface PricingPlan extends PricingPlanTerms {
  readonly id: string;
  readonly organizationId: string;
  readonly status: PricingPlanStatus;
  readonly updatedBy: PricingPlanEditor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What the caller sends; optional fields take their defaults. */
export interface PricingPlanInput {
  readonly name: string;
  readonly description?: string;
  readonly features?: readonly PricingPlanFeature[];
  readonly amount: string;
  readonly allowedGatewayIds?: readonly string[];
  readonly successUrl?: string | null;
  readonly cancelUrl?: string | null;
  readonly expiryMinutes?: number;
}

export interface PricingPlanRules {
  /** Plain-HTTP return URLs are accepted only in development. */
  readonly allowInsecureUrls: boolean;
}

const GATEWAY_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Control characters (newlines included) have no place on a one-line card.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function text(field: string, value: string, max: number, required: boolean) {
  const trimmed = value.trim();
  if (required && trimmed === '') {
    throw new InvalidPricingPlanError(field, 'must not be empty');
  }
  if (trimmed.length > max) {
    throw new InvalidPricingPlanError(field, `must be at most ${max} characters`);
  }
  return trimmed;
}

function features(
  lines: readonly PricingPlanFeature[],
): readonly PricingPlanFeature[] {
  if (lines.length > MAX_FEATURES) {
    throw new InvalidPricingPlanError(
      'features',
      `at most ${MAX_FEATURES} lines are allowed`,
    );
  }
  return lines.map((line, i) => {
    const field = `features.${i}.text`;
    const value = text(field, line.text, MAX_FEATURE_LENGTH, true);
    if (CONTROL_CHARACTERS.test(value)) {
      throw new InvalidPricingPlanError(field, 'must be a single line of plain text');
    }
    return { text: value, included: line.included };
  });
}

function amount(value: string): string {
  try {
    return parseAmount(value, PRICING_PLAN_CURRENCY).value;
  } catch (error) {
    if (error instanceof InvalidAmountError) {
      throw new InvalidPricingPlanError('amount', error.message);
    }
    throw error;
  }
}

function gateways(ids: readonly string[]): readonly string[] {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_ALLOWED_GATEWAYS) {
    throw new InvalidPricingPlanError(
      'allowedGatewayIds',
      `at most ${MAX_ALLOWED_GATEWAYS} PaymentGateways are allowed`,
    );
  }
  for (const id of unique) {
    if (!GATEWAY_ID.test(id)) {
      throw new InvalidPricingPlanError(
        'allowedGatewayIds',
        `${JSON.stringify(id)} is not a PaymentGateway id`,
      );
    }
  }
  return unique;
}

function returnUrl(
  field: string,
  value: string | null | undefined,
  rules: PricingPlanRules,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidPricingPlanError(field, 'must be an absolute URL');
  }
  const allowed = rules.allowInsecureUrls ? ['https:', 'http:'] : ['https:'];
  if (!allowed.includes(url.protocol)) {
    throw new InvalidPricingPlanError(
      field,
      rules.allowInsecureUrls ? 'must be an HTTP(S) URL' : 'must be an HTTPS URL',
    );
  }
  return trimmed;
}

function expiry(minutes: number | undefined): number {
  if (minutes === undefined) return DEFAULT_EXPIRY_MINUTES;
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_EXPIRY_MINUTES ||
    minutes > MAX_EXPIRY_MINUTES
  ) {
    throw new InvalidPricingPlanError(
      'expiryMinutes',
      `must be a whole number of minutes from ${MIN_EXPIRY_MINUTES} (30 minutes) to ${MAX_EXPIRY_MINUTES} (24 hours)`,
    );
  }
  return minutes;
}

/**
 * Validates and normalises what an Organization Admin set: text is trimmed,
 * the Amount normalised as Payment Core will read it, duplicate gateway ids
 * dropped, and a missing Payment Expiry set to the default.
 */
export function definePricingPlanTerms(
  input: PricingPlanInput,
  rules: PricingPlanRules,
): PricingPlanTerms {
  return {
    name: text('name', input.name, MAX_NAME_LENGTH, true),
    description: text(
      'description',
      input.description ?? '',
      MAX_DESCRIPTION_LENGTH,
      false,
    ),
    features: features(input.features ?? []),
    amount: amount(input.amount),
    currency: PRICING_PLAN_CURRENCY,
    allowedGatewayIds: gateways(input.allowedGatewayIds ?? []),
    successUrl: returnUrl('successUrl', input.successUrl, rules),
    cancelUrl: returnUrl('cancelUrl', input.cancelUrl, rules),
    expiryMinutes: expiry(input.expiryMinutes),
  };
}
