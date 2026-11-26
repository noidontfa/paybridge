'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorState, NotFoundState } from '@/components/data-states';
import { PRICING_MANAGE } from '@/components/pricing-plans/pricing-plans-screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import type { PricingPlan } from '@/lib/api/pricing-plans';
import {
  PRICING_TABLE_LIMITS,
  type PricingTable,
  type PricingTableInput,
  type PricingTableLanguage,
  type PricingTableTheme,
} from '@/lib/api/pricing-tables';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/operator';
import { usePricingPlans } from '@/lib/queries/pricing-plans';
import {
  useCreatePricingTable,
  useDeletePricingTable,
  usePricingTable,
  useUpdatePricingTable,
} from '@/lib/queries/pricing-tables';
import { PricingTablePreview } from './pricing-table-preview';
import { PricingTableSnippet } from './pricing-table-snippet';
import { LANGUAGE_NAMES, tableEditorLabel, THEME_NAMES } from './pricing-tables-screen';

const selectClass = 'h-8 w-fit rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-50';

function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : 'Something went wrong'}
    </p>
  );
}

const DEFAULT_LOOK = { mainColor: '#4f46e5', theme: 'light', language: 'vi', buttonText: 'Mua ngay' } as const;

function initialValues(table?: PricingTable): PricingTableInput {
  return {
    name: table?.name ?? '',
    planIds: table?.planIds ?? [],
    recommendedPlanId: table?.recommendedPlanId ?? null,
    mainColor: table?.mainColor ?? DEFAULT_LOOK.mainColor,
    theme: table?.theme ?? DEFAULT_LOOK.theme,
    language: table?.language ?? DEFAULT_LOOK.language,
    buttonText: table?.buttonText ?? DEFAULT_LOOK.buttonText,
  };
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Every field of a Pricing Table, with a live preview of its cards. Without
 * `pricing:manage` it is read-only.
 */
function PricingTableForm({
  table,
  plans,
  canManage,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  table?: PricingTable;
  plans: readonly PricingPlan[];
  canManage: boolean;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: PricingTableInput) => void;
}) {
  const [values, setValues] = useState(() => initialValues(table));
  const set = <K extends keyof PricingTableInput>(key: K, value: PricingTableInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const byId = (id: string) => plans.find((p) => p.id === id);
  const chosen = values.planIds.map(byId).filter((p): p is PricingPlan => p !== undefined);
  const full = values.planIds.length >= PRICING_TABLE_LIMITS.maxPlans;

  const toggle = (id: string, on: boolean) =>
    setValues((v) => {
      const planIds = on ? [...v.planIds, id] : v.planIds.filter((p) => p !== id);
      return { ...v, planIds, recommendedPlanId: planIds.includes(v.recommendedPlanId ?? '') ? v.recommendedPlanId : null };
    });

  return (
    <div className="flex flex-col gap-6">
      <form
        aria-label="Pricing Table"
        className="flex max-w-2xl flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ ...values, name: values.name.trim(), buttonText: values.buttonText.trim() });
        }}
      >
        <fieldset disabled={!canManage} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <Input
                required
                maxLength={PRICING_TABLE_LIMITS.nameMax}
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </label>
            <span className="text-xs text-muted-foreground">For you only; Customers never see it.</span>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Pricing Plans</legend>
            <p className="text-xs text-muted-foreground">
              Pick one to three. A Pricing Plan can be shown in several Pricing Tables. Archived ones show as not available.
            </p>
            {plans.length === 0 && <p className="text-sm text-muted-foreground">Create a Pricing Plan first.</p>}
            {plans.map((plan) => {
              const on = values.planIds.includes(plan.id);
              return (
                <label key={plan.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} disabled={!on && full} onChange={(e) => toggle(plan.id, e.target.checked)} />
                  {plan.name}
                  <span className="text-muted-foreground tabular-nums">{formatMoney(plan.amount)}</span>
                  {plan.status === 'ARCHIVED' && <Badge variant="secondary">Archived</Badge>}
                </label>
              );
            })}
          </fieldset>

          {chosen.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Order</legend>
              <ol aria-label="Card order" className="flex flex-col gap-1">
                {chosen.map((plan, i) => (
                  <li key={plan.id} className="flex items-center gap-2 text-sm">
                    <span className="w-4 text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-32">{plan.name}</span>
                    {canManage && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Move ${plan.name} left`}
                          disabled={i === 0}
                          onClick={() => set('planIds', move(values.planIds, i, i - 1))}
                        >
                          ←
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Move ${plan.name} right`}
                          disabled={i === chosen.length - 1}
                          onClick={() => set('planIds', move(values.planIds, i, i + 1))}
                        >
                          →
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ol>
              <label className="flex flex-col gap-1 text-sm">
                Recommended
                <select
                  className={selectClass}
                  value={values.recommendedPlanId ?? ''}
                  onChange={(e) => set('recommendedPlanId', e.target.value || null)}
                >
                  <option value="">None</option>
                  {chosen.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          )}

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Look</legend>
            <label className="flex items-center gap-2 text-sm">
              Main colour
              <input
                type="color"
                className="h-8 w-12 rounded border"
                value={values.mainColor}
                onChange={(e) => set('mainColor', e.target.value)}
              />
              <code className="text-xs">{values.mainColor}</code>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Theme
              <select className={selectClass} value={values.theme} onChange={(e) => set('theme', e.target.value as PricingTableTheme)}>
                {Object.entries(THEME_NAMES).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Language
              <select
                className={selectClass}
                value={values.language}
                onChange={(e) => set('language', e.target.value as PricingTableLanguage)}
              >
                {Object.entries(LANGUAGE_NAMES).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Button text
              <Input
                required
                className="w-60"
                maxLength={PRICING_TABLE_LIMITS.buttonTextMax}
                value={values.buttonText}
                onChange={(e) => set('buttonText', e.target.value)}
              />
            </label>
          </fieldset>
        </fieldset>

        <ErrorMessage error={error} />
        {canManage && (
          <div>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
      <div className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-sm font-medium">Preview</h2>
        <PricingTablePreview look={values} plans={chosen} recommendedPlanId={values.recommendedPlanId} />
      </div>
    </div>
  );
}

function usePlans() {
  const { data, error, isPending, refetch } = usePricingPlans();
  return { plans: data?.items ?? [], error, isPending, refetch };
}

/** Creates a Pricing Table, then opens it in the editor (where its snippet is). */
export function NewPricingTableScreen() {
  const router = useRouter();
  const canManage = useCan(PRICING_MANAGE);
  const create = useCreatePricingTable();
  const { plans, error, isPending, refetch } = usePlans();
  if (!canManage) {
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        You do not have permission to manage Pricing Tables. Ask an Organization Admin.
      </p>
    );
  }
  if (isPending && !error) return <Skeleton role="status" aria-label="Loading Pricing Plans" className="mx-4 h-64 rounded-xl" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <div className="px-4 pb-6">
      <PricingTableForm
        plans={plans}
        canManage
        submitLabel="Create Pricing Table"
        pending={create.isPending}
        error={create.error}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (created) => router.push(`/pricing-tables/${encodeURIComponent(created.id)}`),
          })
        }
      />
    </div>
  );
}

/** One Pricing Table: every field, its preview, its snippet, and delete. */
export function PricingTableEditorScreen({ id }: { id: string }) {
  const router = useRouter();
  const canManage = useCan(PRICING_MANAGE);
  const { data, error, isPending, refetch } = usePricingTable(id);
  const plans = usePlans();
  const update = useUpdatePricingTable();
  const remove = useDeletePricingTable();
  const [confirming, setConfirming] = useState(false);

  if ((isPending && !error) || (plans.isPending && !plans.error)) {
    return <Skeleton role="status" aria-label="Loading Pricing Table" className="mx-4 h-64 rounded-xl" />;
  }
  if (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return (
        <div className="px-4">
          <NotFoundState title="Pricing Table not found" description="It may have been deleted, or it belongs to another Organization." />
        </div>
      );
    }
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (plans.error) return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Last changed by {tableEditorLabel(data)}</span>
        {update.isSuccess && (
          <span role="status" aria-label="Saved" className="text-foreground">
            Saved
          </span>
        )}
      </div>
      <PricingTableForm
        key={data.updatedAt}
        table={data}
        plans={plans.plans}
        canManage={canManage}
        submitLabel="Save changes"
        pending={update.isPending}
        error={update.error}
        onSubmit={(input) => update.mutate({ id, input })}
      />
      <PricingTableSnippet pricingTableId={data.id} />
      {canManage && (
        <section aria-label="Delete" className="flex max-w-2xl flex-col gap-2 rounded-xl border p-4">
          {confirming ? (
            <div role="group" aria-label="Delete Pricing Table" className="flex flex-col gap-2">
              <p className="text-sm">Pages that still embed this Pricing Table will show it as unavailable. This cannot be undone.</p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(id, { onSuccess: () => router.push('/pricing-tables') })}
                >
                  Delete Pricing Table
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="outline" onClick={() => setConfirming(true)}>
                Delete…
              </Button>
            </div>
          )}
          <ErrorMessage error={remove.error} />
        </section>
      )}
    </div>
  );
}
