// COPIED BY HAND from apps/console/src/lib/api/pricing-tables.ts (client functions and form limits left out). Keep in sync: ADR 0004.
// Do not edit this copy; change the Console file and copy again.
/**
 * `/internal/pricing-tables`: one to three Pricing Plans shown on a website,
 * and `/api/checkout/pricing-tables/:id`, what the SDK draws (previewed in the
 * Console).
 */
import { z } from 'zod';

export const pricingTableThemeSchema = z.enum(['light', 'dark']);
export const pricingTableLanguageSchema = z.enum(['vi', 'en']);

export const pricingTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Pricing Plan ids in card order. */
  planIds: z.array(z.string()),
  recommendedPlanId: z.string().nullable(),
  /** `#rrggbb`. */
  mainColor: z.string(),
  theme: pricingTableThemeSchema,
  language: pricingTableLanguageSchema,
  buttonText: z.string(),
  updatedBy: z.object({
    userId: z.string(),
    role: z.string(),
    name: z.string(),
    /** "Super Admin (PayBridge)" for a platform change, otherwise null. */
    label: z.string().nullable(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pricingTableListSchema = z.object({ items: z.array(pricingTableSchema) });

/** What the public read returns for one card. */
export const publicPricingTablePlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  features: z.array(z.object({ text: z.string(), included: z.boolean() })),
  amount: z.string(),
  currency: z.string(),
  recommended: z.boolean(),
  /** Allowed by the Pricing Plan and enabled for the Organization. */
  gateways: z.array(z.object({ id: z.string() })),
  buyable: z.boolean(),
  /** For the developer console only: PRICING_PLAN_ARCHIVED or NO_GATEWAY. */
  unavailableReason: z.string().nullable(),
});

export const publicPricingTableSchema = z.object({
  id: z.string(),
  mainColor: z.string(),
  theme: pricingTableThemeSchema,
  language: pricingTableLanguageSchema,
  buttonText: z.string(),
  plans: z.array(publicPricingTablePlanSchema),
});
