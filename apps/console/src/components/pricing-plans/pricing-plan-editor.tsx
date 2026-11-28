'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorState, NotFoundState } from '@/components/shared/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/services/errors';
import {
  PRICING_PLAN_LIMITS,
  type PricingPlanDetail,
  type PricingPlanFeature,
  type PricingPlanInput,
} from '@/lib/api/pricing-plans';
import { useCan } from '@/features/auth/hooks/use-operator';
import { useGatewayOptions } from '@/features/gateways/hooks/queries';
import {
  useArchivePricingPlan,
  useCreatePricingPlan,
  useDeletePricingPlan,
  usePricingPlan,
  useRestorePricingPlan,
  useUpdatePricingPlan,
} from '@/lib/queries/pricing-plans';
import { editorLabel, PRICING_MANAGE } from './pricing-plans-screen';

const textareaClass =
  'min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm disabled:opacity-50';

function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : 'Something went wrong'}
    </p>
  );
}

interface FormValues {
  name: string;
  description: string;
  features: PricingPlanFeature[];
  amount: string;
  allowedGatewayIds: string[];
  successUrl: string;
  cancelUrl: string;
  expiryMinutes: string;
}

function initialValues(plan?: PricingPlanDetail): FormValues {
  return {
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    features: plan?.features.map((f) => ({ ...f })) ?? [],
    amount: plan?.amount ?? '',
    allowedGatewayIds: plan?.allowedGatewayIds ?? [],
    successUrl: plan?.successUrl ?? '',
    cancelUrl: plan?.cancelUrl ?? '',
    expiryMinutes: String(plan?.expiryMinutes ?? PRICING_PLAN_LIMITS.expiryDefaultMinutes),
  };
}

function toInput(values: FormValues): PricingPlanInput {
  return {
    name: values.name,
    description: values.description,
    features: values.features,
    amount: values.amount.trim(),
    allowedGatewayIds: values.allowedGatewayIds,
    successUrl: values.successUrl.trim() || null,
    cancelUrl: values.cancelUrl.trim() || null,
    expiryMinutes: Number(values.expiryMinutes),
  };
}

/**
 * Every field of a Pricing Plan. Feature lines are plain text: they are shown
 * as typed and never rendered as HTML. Without `pricing:manage` it is read-only.
 */
function PricingPlanForm({
  plan,
  canManage,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  plan?: PricingPlanDetail;
  canManage: boolean;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: PricingPlanInput) => void;
}) {
  const [values, setValues] = useState(() => initialValues(plan));
  const gateways = useGatewayOptions();
  const gatewayIds = [...new Set([...gateways.map((g) => g.value), ...values.allowedGatewayIds])];
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const setFeature = (index: number, change: Partial<PricingPlanFeature>) =>
    set(
      'features',
      values.features.map((f, i) => (i === index ? { ...f, ...change } : f)),
    );

  return (
    <form
      aria-label="Pricing Plan"
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(toInput(values));
      }}
    >
      <fieldset disabled={!canManage} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <Input
            required
            maxLength={PRICING_PLAN_LIMITS.nameMax}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea
            className={textareaClass}
            maxLength={PRICING_PLAN_LIMITS.descriptionMax}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Amount (VND)
          <Input
            required
            inputMode="numeric"
            placeholder="199000"
            value={values.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Features</legend>
          <p className="text-xs text-muted-foreground">
            Plain text, one line each, up to {PRICING_PLAN_LIMITS.features}. Mark what the Pricing Plan does not include.
          </p>
          {values.features.map((feature, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Feature ${i + 1}`}
                required
                maxLength={PRICING_PLAN_LIMITS.featureMax}
                value={feature.text}
                onChange={(e) => setFeature(i, { text: e.target.value })}
              />
              <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                <input
                  type="checkbox"
                  aria-label={`Included: Feature ${i + 1}`}
                  checked={feature.included}
                  onChange={(e) => setFeature(i, { included: e.target.checked })}
                />
                Included
              </label>
              {canManage && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove feature ${i + 1}`}
                  onClick={() => set('features', values.features.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {canManage && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={values.features.length >= PRICING_PLAN_LIMITS.features}
                onClick={() => set('features', [...values.features, { text: '', included: true }])}
              >
                Add feature
              </Button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Allowed gateways</legend>
          <p className="text-xs text-muted-foreground">None checked: every gateway the Organization has enabled.</p>
          <div className="flex flex-wrap gap-4">
            {gatewayIds.map((id) => (
              <label key={id} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={values.allowedGatewayIds.includes(id)}
                  onChange={(e) =>
                    set(
                      'allowedGatewayIds',
                      e.target.checked
                        ? [...values.allowedGatewayIds, id]
                        : values.allowedGatewayIds.filter((g) => g !== id),
                    )
                  }
                />
                {id}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          Success URL
          <Input
            type="url"
            placeholder="https://example.com/thanks"
            value={values.successUrl}
            onChange={(e) => set('successUrl', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Cancel URL
          <Input
            type="url"
            placeholder="https://example.com/pricing"
            value={values.cancelUrl}
            onChange={(e) => set('cancelUrl', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Payment Expiry (minutes)
          <Input
            type="number"
            required
            min={PRICING_PLAN_LIMITS.expiryMinMinutes}
            max={PRICING_PLAN_LIMITS.expiryMaxMinutes}
            step={1}
            className="w-40"
            value={values.expiryMinutes}
            onChange={(e) => set('expiryMinutes', e.target.value)}
          />
          <span className="text-xs text-muted-foreground">From 30 minutes to 24 hours (1440).</span>
        </label>
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
  );
}

/** Archive (warning about the Pricing Tables that show it first), restore and delete. */
function Lifecycle({ plan }: { plan: PricingPlanDetail }) {
  const router = useRouter();
  const archive = useArchivePricingPlan();
  const restore = useRestorePricingPlan();
  const remove = useDeletePricingPlan();
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-label="Status" className="flex max-w-2xl flex-col gap-3 rounded-xl border p-4">
      {plan.status === 'ACTIVE' ? (
        confirming ? (
          <div role="group" aria-label="Archive Pricing Plan" className="flex flex-col gap-2">
            {plan.pricingTables.length > 0 ? (
              <p className="text-sm">
                Shown in {plan.pricingTables.length === 1 ? 'this Pricing Table' : 'these Pricing Tables'}:{' '}
                <strong>{plan.pricingTables.map((t) => t.name).join(', ')}</strong>. Pages that embed{' '}
                {plan.pricingTables.length === 1 ? 'it' : 'them'} will show this Pricing Plan as unavailable.
              </p>
            ) : (
              <p className="text-sm">No Pricing Table shows this Pricing Plan.</p>
            )}
            <p className="text-sm text-muted-foreground">An archived Pricing Plan can no longer be bought. Its Payments keep their history.</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => archive.mutate(plan.id, { onSuccess: () => setConfirming(false) })}
              >
                Archive Pricing Plan
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Archive…
            </Button>
          </div>
        )
      ) : (
        <div>
          <Button variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(plan.id)}>
            Restore
          </Button>
        </div>
      )}
      <div>
        <Button
          variant="outline"
          disabled={remove.isPending}
          onClick={() => remove.mutate(plan.id, { onSuccess: () => router.push('/pricing-plans') })}
        >
          Delete
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">Only a Pricing Plan that has never been paid for can be deleted.</p>
      </div>
      <ErrorMessage error={archive.error ?? restore.error ?? remove.error} />
    </section>
  );
}

/** Creates a Pricing Plan, then opens it in the editor. */
export function NewPricingPlanScreen() {
  const router = useRouter();
  const canManage = useCan(PRICING_MANAGE);
  const create = useCreatePricingPlan();
  if (!canManage) {
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        You do not have permission to manage Pricing Plans. Ask an Organization Admin.
      </p>
    );
  }
  return (
    <div className="px-4 pb-6">
      <PricingPlanForm
        canManage
        submitLabel="Create Pricing Plan"
        pending={create.isPending}
        error={create.error}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (created) => router.push(`/pricing-plans/${encodeURIComponent(created.id)}`),
          })
        }
      />
    </div>
  );
}

/** One Pricing Plan: every field editable at any time, and its status. */
export function PricingPlanEditorScreen({ id }: { id: string }) {
  const canManage = useCan(PRICING_MANAGE);
  const { data, error, isPending, refetch } = usePricingPlan(id);
  const update = useUpdatePricingPlan();

  if (isPending && !error) {
    return <Skeleton role="status" aria-label="Loading Pricing Plan" className="mx-4 h-64 rounded-xl" />;
  }
  if (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return (
        <div className="px-4">
          <NotFoundState title="Pricing Plan not found" description="It may have been deleted, or it belongs to another Organization." />
        </div>
      );
    }
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant={data.status === 'ACTIVE' ? 'default' : 'secondary'}>{data.status === 'ACTIVE' ? 'Active' : 'Archived'}</Badge>
        <span>Last changed by {editorLabel(data)}</span>
        {update.isSuccess && (
          <span role="status" aria-label="Saved" className="text-foreground">
            Saved
          </span>
        )}
      </div>
      <PricingPlanForm
        key={data.updatedAt}
        plan={data}
        canManage={canManage}
        submitLabel="Save changes"
        pending={update.isPending}
        error={update.error}
        onSubmit={(input) => update.mutate({ id, input })}
      />
      {canManage && <Lifecycle plan={data} />}
    </div>
  );
}
