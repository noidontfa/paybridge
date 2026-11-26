/**
 * `/internal/pricing-plans`: what the Organization sells. Operators read;
 * Organization Admins (and Super Admins, shown as the platform) write. Edits
 * are POSTs, deletes are DELETE, so the BFF needs no new methods.
 *
 * COPIED BY HAND to apps/api/test/contract/console/pricing-plans.ts.
 */
import { z } from 'zod';
import { request } from './client';

export const pricingPlanFeatureSchema = z.object({ text: z.string(), included: z.boolean() });
export type PricingPlanFeature = z.infer<typeof pricingPlanFeatureSchema>;

export const pricingPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  features: z.array(pricingPlanFeatureSchema),
  /** A decimal string in whole dong. */
  amount: z.string(),
  currency: z.string(),
  /** Empty means every enabled PaymentGateway. */
  allowedGatewayIds: z.array(z.string()),
  successUrl: z.string().nullable(),
  cancelUrl: z.string().nullable(),
  expiryMinutes: z.number().int(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
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
export type PricingPlan = z.infer<typeof pricingPlanSchema>;

export const pricingTableRefSchema = z.object({ id: z.string(), name: z.string() });
export type PricingTableRef = z.infer<typeof pricingTableRefSchema>;

export const pricingPlanDetailSchema = pricingPlanSchema.extend({
  /** The Pricing Tables that show this Pricing Plan (warned about before archiving). */
  pricingTables: z.array(pricingTableRefSchema),
});
export type PricingPlanDetail = z.infer<typeof pricingPlanDetailSchema>;

export const pricingPlanListSchema = z.object({ items: z.array(pricingPlanSchema) });

/** What the editor sends: every field, so an edit replaces them all. */
export interface PricingPlanInput {
  name: string;
  description: string;
  features: PricingPlanFeature[];
  amount: string;
  allowedGatewayIds: string[];
  successUrl: string | null;
  cancelUrl: string | null;
  expiryMinutes: number;
}

/** The API's limits, mirrored for the form. */
export const PRICING_PLAN_LIMITS = {
  nameMax: 100,
  descriptionMax: 1000,
  features: 10,
  featureMax: 200,
  expiryMinMinutes: 30,
  expiryMaxMinutes: 24 * 60,
  expiryDefaultMinutes: 30,
} as const;

const PATH = '/internal/pricing-plans';
const one = (id: string) => `${PATH}/${encodeURIComponent(id)}`;

export function listPricingPlans(signal?: AbortSignal) {
  return request(PATH, pricingPlanListSchema, { signal });
}

export function getPricingPlan(id: string, signal?: AbortSignal) {
  return request(one(id), pricingPlanDetailSchema, { signal });
}

export function createPricingPlan(input: PricingPlanInput) {
  return request(PATH, pricingPlanSchema, { method: 'POST', body: input });
}

export function updatePricingPlan(id: string, input: PricingPlanInput) {
  return request(one(id), pricingPlanSchema, { method: 'POST', body: input });
}

export function archivePricingPlan(id: string) {
  return request(`${one(id)}/archive`, pricingPlanDetailSchema, { method: 'POST', body: {} });
}

export function restorePricingPlan(id: string) {
  return request(`${one(id)}/restore`, pricingPlanDetailSchema, { method: 'POST', body: {} });
}

export function deletePricingPlan(id: string) {
  return request(one(id), z.object({ deleted: z.boolean() }), { method: 'DELETE' });
}
