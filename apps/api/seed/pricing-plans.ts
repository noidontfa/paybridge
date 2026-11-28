import type { PrismaClient } from '../src/generated/prisma/client.js';

// Seed Pricing Plans (embedded-checkout ticket 05): a few in the default
// Organization, one of them archived, and one in Acme Retail. Ids are fixed,
// so a re-run resets them to this state.

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

interface SeedEditor {
  readonly userId: string;
  readonly role: string;
  readonly name: string;
}

export interface SeedPricingPlansContext {
  /** Fixed UUID v5 for a seed name. */
  readonly id: (name: string) => string;
  readonly organizations: { readonly primary: string; readonly acme: string };
  /** Who the seeded plans were last changed by, per Organization. */
  readonly editors: { readonly primary: SeedEditor; readonly acme: SeedEditor };
  readonly now: number;
}

interface SeedPlan {
  readonly key: string;
  readonly organization: 'primary' | 'acme';
  readonly name: string;
  readonly description: string;
  readonly features: readonly { text: string; included: boolean }[];
  readonly amount: string;
  readonly allowedGatewayIds: readonly string[];
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
  readonly expiryMinutes: number;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

const DAY = 24 * 60 * 60_000;

export const SEED_PRICING_PLANS: readonly SeedPlan[] = [
  {
    key: 'primary-basic',
    organization: 'primary',
    name: 'Basic',
    description: 'For individuals getting started.',
    features: [
      { text: '1 project', included: true },
      { text: 'Email support', included: true },
      { text: 'Priority support', included: false },
    ],
    amount: '99000',
    allowedGatewayIds: [],
    successUrl: null,
    cancelUrl: null,
    expiryMinutes: 30,
    status: 'ACTIVE',
  },
  {
    key: 'primary-pro',
    organization: 'primary',
    name: 'Pro',
    description: 'For growing teams.',
    features: [
      { text: 'Unlimited projects', included: true },
      { text: 'Email support', included: true },
      { text: 'Priority support', included: true },
    ],
    amount: '299000',
    allowedGatewayIds: ['fake'],
    successUrl: 'https://shop.example/thanks',
    cancelUrl: 'https://shop.example/pricing',
    expiryMinutes: 60,
    status: 'ACTIVE',
  },
  {
    key: 'primary-legacy',
    organization: 'primary',
    name: 'Legacy Starter',
    description: 'No longer sold.',
    features: [{ text: '1 project', included: true }],
    amount: '49000',
    allowedGatewayIds: [],
    successUrl: null,
    cancelUrl: null,
    expiryMinutes: 30,
    status: 'ARCHIVED',
  },
  {
    key: 'acme-membership',
    organization: 'acme',
    name: 'Acme Membership',
    description: 'A year of member prices.',
    features: [
      { text: '10% off every order', included: true },
      { text: 'Free delivery', included: false },
    ],
    amount: '500000',
    allowedGatewayIds: ['fake', 'stripe'],
    successUrl: null,
    cancelUrl: null,
    expiryMinutes: 24 * 60,
    status: 'ACTIVE',
  },
];

/** Creates or resets the seed Pricing Plans; returns how many there are. */
export async function seedPricingPlans(
  tx: Tx,
  ctx: SeedPricingPlansContext,
): Promise<number> {
  for (const [i, plan] of SEED_PRICING_PLANS.entries()) {
    const editor = ctx.editors[plan.organization];
    const at = new Date(ctx.now - (SEED_PRICING_PLANS.length - i) * DAY);
    const data = {
      organizationId: ctx.organizations[plan.organization],
      name: plan.name,
      description: plan.description,
      features: plan.features.map((f) => ({ ...f })),
      amount: plan.amount,
      currency: 'VND',
      allowedGatewayIds: [...plan.allowedGatewayIds],
      successUrl: plan.successUrl,
      cancelUrl: plan.cancelUrl,
      expiryMinutes: plan.expiryMinutes,
      status: plan.status,
      updatedByUserId: editor.userId,
      updatedByRole: editor.role,
      updatedByName: editor.name,
      createdAt: at,
      updatedAt: at,
    };
    const id = ctx.id(`pricing-plan:${plan.key}`);
    await tx.pricingPlan.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }
  return SEED_PRICING_PLANS.length;
}
