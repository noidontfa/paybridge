/**
 * `/internal/pricing-tables`: one to three Pricing Plans shown on a website,
 * and `/api/checkout/pricing-tables/:id`, what the SDK draws (previewed in the
 * Console). Operators read; Organization Admins (and Super Admins, shown as
 * the platform) write. Edits are POSTs, deletes are DELETE, so the BFF needs
 * no new methods.
 *
 * COPIED BY HAND to apps/api/test/contract/console/pricing-tables.ts.
 */
import { z } from 'zod';
import { request } from '@/services/client';

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
export type PricingTable = z.infer<typeof pricingTableSchema>;
export type PricingTableTheme = z.infer<typeof pricingTableThemeSchema>;
export type PricingTableLanguage = z.infer<typeof pricingTableLanguageSchema>;

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
  /** For the developer console only: PRICING_PLAN_ARCHIVED or NO_GATEWAY_AVAILABLE. */
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

/** What the editor sends: every field, so an edit replaces them all. */
export interface PricingTableInput {
  name: string;
  planIds: string[];
  recommendedPlanId: string | null;
  mainColor: string;
  theme: PricingTableTheme;
  language: PricingTableLanguage;
  buttonText: string;
}

/** The API's limits, mirrored for the form. */
export const PRICING_TABLE_LIMITS = {
  nameMax: 100,
  minPlans: 1,
  maxPlans: 3,
  buttonTextMax: 40,
} as const;

const PATH = '/internal/pricing-tables';
const one = (id: string) => `${PATH}/${encodeURIComponent(id)}`;

export function listPricingTables(signal?: AbortSignal) {
  return request(PATH, pricingTableListSchema, { signal });
}

export function getPricingTable(id: string, signal?: AbortSignal) {
  return request(one(id), pricingTableSchema, { signal });
}

export function createPricingTable(input: PricingTableInput) {
  return request(PATH, pricingTableSchema, { method: 'POST', body: input });
}

export function updatePricingTable(id: string, input: PricingTableInput) {
  return request(one(id), pricingTableSchema, { method: 'POST', body: input });
}

export function deletePricingTable(id: string) {
  return request(one(id), z.object({ deleted: z.boolean() }), { method: 'DELETE' });
}
