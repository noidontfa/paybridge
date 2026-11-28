/**
 * The mocked Pricing Table endpoints, with the API's validation rules so the
 * editor's error path can be exercised. The mock has one Organization.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { PRICING_TABLE_LIMITS, type PricingTable, type PricingTableInput } from '@/lib/api/pricing-tables';
import type { MockStore } from './store';

type ErrorInit = { status: number; error: string; code: string; message: string; details?: unknown };

const MOCK_EDITOR: PricingTable['updatedBy'] = { userId: 'dana', role: 'ORGANIZATION_ADMIN', name: 'Dana Admin', label: null };

/** The seeded Pricing Table: Basic, Pro (recommended) and the archived Legacy Starter. */
export function seedPricingTables(store: MockStore): void {
  const at = new Date(store.now.getTime() - 6 * 86_400_000).toISOString();
  store.pricingTables.push({
    id: 'table-home',
    name: 'Home page pricing',
    planIds: ['plan-basic', 'plan-pro', 'plan-legacy'],
    recommendedPlanId: 'plan-pro',
    mainColor: '#4f46e5',
    theme: 'light',
    language: 'vi',
    buttonText: 'Mua ngay',
    updatedBy: MOCK_EDITOR,
    createdAt: at,
    updatedAt: at,
  });
}

/** The Pricing Tables that show a Pricing Plan, as the Pricing Plan detail lists them. */
export function pricingTablesOf(store: MockStore, planId: string): { id: string; name: string }[] {
  return store.pricingTables.filter((t) => t.planIds.includes(planId)).map((t) => ({ id: t.id, name: t.name }));
}

/** The first broken rule as `[field, message]`, or null. */
function invalid(body: Partial<PricingTableInput>): [string, string] | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return ['name', 'must not be empty'];
  const planIds = body.planIds ?? [];
  if (planIds.length < PRICING_TABLE_LIMITS.minPlans || planIds.length > PRICING_TABLE_LIMITS.maxPlans) {
    return ['planIds', 'must hold 1 to 3 Pricing Plans'];
  }
  if (new Set(planIds).size !== planIds.length) return ['planIds', 'must not repeat a Pricing Plan'];
  if (body.recommendedPlanId && !planIds.includes(body.recommendedPlanId)) {
    return ['recommendedPlanId', 'must be one of the Pricing Table’s Pricing Plans'];
  }
  if (typeof body.mainColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.mainColor)) {
    return ['mainColor', 'must be a colour like #4f46e5'];
  }
  const button = body.buttonText?.trim() ?? '';
  if (!button || button.length > PRICING_TABLE_LIMITS.buttonTextMax) return ['buttonText', 'must be 1 to 40 characters'];
  return null;
}

function terms(body: Partial<PricingTableInput>) {
  return {
    name: body.name!.trim(),
    planIds: [...body.planIds!],
    recommendedPlanId: body.recommendedPlanId ?? null,
    mainColor: body.mainColor!.toLowerCase(),
    theme: body.theme ?? 'light',
    language: body.language ?? 'vi',
    buttonText: body.buttonText!.trim(),
  };
}

export function pricingTablesHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: ErrorInit) => Response,
): HttpHandler[] {
  const path = `${base}/internal/pricing-tables`;
  const notFound = (request: Request) =>
    error(request, { status: 404, error: 'Not Found', code: 'PRICING_TABLE_NOT_FOUND', message: 'Pricing Table not found' });
  const badRequest = (request: Request, [field, message]: [string, string]) =>
    error(request, {
      status: 400,
      error: 'Bad Request',
      code: 'INVALID_PRICING_TABLE',
      message: `${field}: ${message}`,
      details: { field },
    });
  const unknownPlan = (request: Request, body: Partial<PricingTableInput>) => {
    const missing = (body.planIds ?? []).find((id) => !store.pricingPlans.some((p) => p.id === id));
    return missing
      ? error(request, { status: 404, error: 'Not Found', code: 'PRICING_PLAN_NOT_FOUND', message: `Pricing Plan ${missing} not found` })
      : null;
  };
  const find = (id: unknown) => store.pricingTables.find((t) => t.id === String(id));
  const body = async (request: Request) => (await request.json().catch(() => ({}))) as Partial<PricingTableInput>;

  return [
    http.get(path, () =>
      HttpResponse.json({ items: [...store.pricingTables].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }),
    ),
    http.get(`${path}/:id`, ({ request, params }) => {
      const table = find(params.id);
      return table ? HttpResponse.json(table) : notFound(request);
    }),
    http.post(path, async ({ request }) => {
      const input = await body(request);
      const broken = invalid(input);
      if (broken) return badRequest(request, broken);
      const missing = unknownPlan(request, input);
      if (missing) return missing;
      const now = store.clock().toISOString();
      const created: PricingTable = {
        id: `table-${store.pricingTables.length + 1}-${Date.now().toString(36)}`,
        ...terms(input),
        updatedBy: MOCK_EDITOR,
        createdAt: now,
        updatedAt: now,
      };
      store.pricingTables.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${path}/:id`, async ({ request, params }) => {
      const table = find(params.id);
      if (!table) return notFound(request);
      const input = await body(request);
      const broken = invalid(input);
      if (broken) return badRequest(request, broken);
      const missing = unknownPlan(request, input);
      if (missing) return missing;
      Object.assign(table, terms(input), { updatedBy: MOCK_EDITOR, updatedAt: store.clock().toISOString() });
      return HttpResponse.json(table);
    }),
    http.delete(`${path}/:id`, ({ request, params }) => {
      const index = store.pricingTables.findIndex((t) => t.id === String(params.id));
      if (index < 0) return notFound(request);
      store.pricingTables.splice(index, 1);
      return HttpResponse.json({ deleted: true });
    }),
  ];
}
