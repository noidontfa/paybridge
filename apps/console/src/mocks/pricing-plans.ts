/**
 * The mocked Pricing Plan endpoints, with the API's main validation rules so
 * the editor's error path can be exercised. The mock has one Organization.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { PRICING_PLAN_LIMITS, type PricingPlan, type PricingPlanInput } from '@/features/pricing-plans/api';
import { pricingTablesOf } from './pricing-tables';
import type { MockStore } from './store';

type ErrorInit = { status: number; error: string; code: string; message: string; details?: unknown };

const MOCK_EDITOR: PricingPlan['updatedBy'] = { userId: 'dana', role: 'ORGANIZATION_ADMIN', name: 'Dana Admin', label: null };

/** The seeded Pricing Plans: a few active ones and an archived one. */
export function seedPricingPlans(store: MockStore): void {
  const at = (daysAgo: number) => new Date(store.now.getTime() - daysAgo * 86_400_000).toISOString();
  const plan = (id: string, daysAgo: number, fields: Partial<PricingPlan> & Pick<PricingPlan, 'name' | 'amount'>): PricingPlan => ({
    id,
    description: '',
    features: [],
    currency: 'VND',
    allowedGatewayIds: [],
    successUrl: null,
    cancelUrl: null,
    expiryMinutes: 30,
    status: 'ACTIVE',
    updatedBy: MOCK_EDITOR,
    createdAt: at(daysAgo),
    updatedAt: at(daysAgo),
    ...fields,
  });
  store.pricingPlans.push(
    plan('plan-basic', 9, {
      name: 'Basic',
      description: 'For individuals getting started.',
      amount: '99000',
      features: [
        { text: '1 project', included: true },
        { text: 'Priority support', included: false },
      ],
    }),
    plan('plan-pro', 8, {
      name: 'Pro',
      description: 'For growing teams.',
      amount: '299000',
      features: [
        { text: 'Unlimited projects', included: true },
        { text: 'Priority support', included: true },
      ],
      allowedGatewayIds: ['fake'],
      successUrl: 'https://shop.example/thanks',
      cancelUrl: 'https://shop.example/pricing',
      expiryMinutes: 60,
    }),
    plan('plan-legacy', 7, { name: 'Legacy Starter', amount: '49000', status: 'ARCHIVED' }),
  );
}

/** The first broken rule as `[field, message]`, or null. */
function invalid(body: Partial<PricingPlanInput>): [string, string] | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return ['name', 'must not be empty'];
  if (typeof body.amount !== 'string' || !/^\d+$/.test(body.amount) || /^0+$/.test(body.amount)) {
    return ['amount', 'Amount must be a whole number of dong greater than zero'];
  }
  const features = body.features ?? [];
  if (features.length > PRICING_PLAN_LIMITS.features) return ['features', `at most ${PRICING_PLAN_LIMITS.features} lines are allowed`];
  const blank = features.findIndex((f) => !f.text.trim());
  if (blank >= 0) return [`features.${blank}.text`, 'must not be empty'];
  for (const field of ['successUrl', 'cancelUrl'] as const) {
    const url = body[field];
    if (url && !url.startsWith('https://')) return [field, 'must be an HTTPS URL'];
  }
  const expiry = body.expiryMinutes ?? PRICING_PLAN_LIMITS.expiryDefaultMinutes;
  if (!Number.isInteger(expiry) || expiry < PRICING_PLAN_LIMITS.expiryMinMinutes || expiry > PRICING_PLAN_LIMITS.expiryMaxMinutes) {
    return ['expiryMinutes', 'must be a whole number of minutes from 30 (30 minutes) to 1440 (24 hours)'];
  }
  return null;
}

function terms(body: Partial<PricingPlanInput>) {
  return {
    name: body.name!.trim(),
    description: (body.description ?? '').trim(),
    features: (body.features ?? []).map((f) => ({ text: f.text.trim(), included: f.included })),
    amount: body.amount!,
    allowedGatewayIds: [...new Set(body.allowedGatewayIds ?? [])],
    successUrl: body.successUrl || null,
    cancelUrl: body.cancelUrl || null,
    expiryMinutes: body.expiryMinutes ?? PRICING_PLAN_LIMITS.expiryDefaultMinutes,
  };
}

export function pricingPlansHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: ErrorInit) => Response,
): HttpHandler[] {
  const path = `${base}/internal/pricing-plans`;
  const notFound = (request: Request) =>
    error(request, { status: 404, error: 'Not Found', code: 'PRICING_PLAN_NOT_FOUND', message: 'Pricing Plan not found' });
  const badRequest = (request: Request, [field, message]: [string, string]) =>
    error(request, {
      status: 400,
      error: 'Bad Request',
      code: 'INVALID_PRICING_PLAN',
      message: `${field}: ${message}`,
      details: { field },
    });
  const detail = (plan: PricingPlan) => ({ ...plan, pricingTables: pricingTablesOf(store, plan.id) });
  const find = (id: unknown) => store.pricingPlans.find((p) => p.id === String(id));
  const body = async (request: Request) => (await request.json().catch(() => ({}))) as Partial<PricingPlanInput>;
  const setStatus = (request: Request, id: unknown, status: PricingPlan['status']) => {
    const plan = find(id);
    if (!plan) return notFound(request);
    Object.assign(plan, { status, updatedBy: MOCK_EDITOR, updatedAt: store.clock().toISOString() });
    return HttpResponse.json(detail(plan));
  };

  return [
    http.get(path, () =>
      HttpResponse.json({ items: [...store.pricingPlans].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }),
    ),
    http.get(`${path}/:id`, ({ request, params }) => {
      const plan = find(params.id);
      return plan ? HttpResponse.json(detail(plan)) : notFound(request);
    }),
    http.post(path, async ({ request }) => {
      const input = await body(request);
      const broken = invalid(input);
      if (broken) return badRequest(request, broken);
      const now = store.clock().toISOString();
      const created: PricingPlan = {
        id: `plan-${store.pricingPlans.length + 1}-${Date.now().toString(36)}`,
        ...terms(input),
        currency: 'VND',
        status: 'ACTIVE',
        updatedBy: MOCK_EDITOR,
        createdAt: now,
        updatedAt: now,
      };
      store.pricingPlans.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${path}/:id/archive`, ({ request, params }) => setStatus(request, params.id, 'ARCHIVED')),
    http.post(`${path}/:id/restore`, ({ request, params }) => setStatus(request, params.id, 'ACTIVE')),
    http.post(`${path}/:id`, async ({ request, params }) => {
      const plan = find(params.id);
      if (!plan) return notFound(request);
      const input = await body(request);
      const broken = invalid(input);
      if (broken) return badRequest(request, broken);
      Object.assign(plan, terms(input), { updatedBy: MOCK_EDITOR, updatedAt: store.clock().toISOString() });
      return HttpResponse.json(plan);
    }),
    http.delete(`${path}/:id`, ({ request, params }) => {
      const index = store.pricingPlans.findIndex((p) => p.id === String(params.id));
      if (index < 0) return notFound(request);
      if (pricingTablesOf(store, String(params.id)).length > 0) {
        return error(request, {
          status: 409,
          error: 'Conflict',
          code: 'PRICING_PLAN_IN_PRICING_TABLES',
          message: 'This Pricing Plan is shown in Pricing Tables; remove it from them or archive it instead',
        });
      }
      store.pricingPlans.splice(index, 1);
      return HttpResponse.json({ deleted: true });
    }),
  ];
}
