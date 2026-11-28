// COPIED BY HAND from apps/console/src/features/pricing-plans/api.ts (client functions and form limits left out). Keep in sync: ADR 0004.
// Do not edit this copy; change the Console file and copy again.
/**
 * `/internal/pricing-plans`: what the Organization sells.
 */
import { z } from 'zod';

export const pricingPlanFeatureSchema = z.object({ text: z.string(), included: z.boolean() });

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

export const pricingTableRefSchema = z.object({ id: z.string(), name: z.string() });

export const pricingPlanDetailSchema = pricingPlanSchema.extend({
  /** The Pricing Tables that show this Pricing Plan (warned about before archiving). */
  pricingTables: z.array(pricingTableRefSchema),
});

export const pricingPlanListSchema = z.object({ items: z.array(pricingPlanSchema) });
