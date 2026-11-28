'use client';

import { CheckIcon, XIcon } from 'lucide-react';
import type { PricingPlan } from '@/features/pricing-plans/api';
import type { PricingTableLanguage, PricingTableTheme } from '@/features/pricing-tables/api';
import { formatMoney } from '@/utils/format';

/** The few words a card shows besides the Organization's own text. */
const WORDS: Record<PricingTableLanguage, { recommended: string; unavailable: string }> = {
  vi: { recommended: 'Đề xuất', unavailable: 'Tạm ngừng bán' },
  en: { recommended: 'Recommended', unavailable: 'Not available' },
};

export interface PreviewLook {
  mainColor: string;
  theme: PricingTableTheme;
  language: PricingTableLanguage;
  buttonText: string;
}

/**
 * A static preview of the price cards the SDK draws: the theme, the
 * recommended badge, features as plain text with ✓/✗, and archived Pricing
 * Plans kept in their column but not buyable. Which PaymentGateways are
 * enabled is decided when the page loads, so the preview leaves them out.
 */
export function PricingTablePreview({
  look,
  plans,
  recommendedPlanId,
}: {
  look: PreviewLook;
  plans: readonly PricingPlan[];
  recommendedPlanId: string | null;
}) {
  const dark = look.theme === 'dark';
  const words = WORDS[look.language];
  return (
    <section
      aria-label="Preview"
      data-theme={look.theme}
      className={`rounded-xl border p-4 ${dark ? 'bg-zinc-900 text-zinc-50' : 'bg-white text-zinc-900'}`}
    >
      {plans.length === 0 ? (
        <p className="text-sm opacity-70">Pick a Pricing Plan to see its card.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-3">
          {plans.map((plan) => {
            const recommended = plan.id === recommendedPlanId;
            const buyable = plan.status === 'ACTIVE';
            return (
              <li
                key={plan.id}
                aria-label={plan.name}
                className={`flex flex-col gap-3 rounded-lg border p-4 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}
                style={recommended ? { borderColor: look.mainColor, borderWidth: 2 } : undefined}
              >
                {recommended && (
                  <span
                    className="self-start rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: look.mainColor }}
                  >
                    {words.recommended}
                  </span>
                )}
                <h3 className="text-base font-semibold">{plan.name}</h3>
                <p className="text-2xl font-bold tabular-nums">{formatMoney(plan.amount)}</p>
                {plan.description && <p className="text-sm opacity-80">{plan.description}</p>}
                <ul className="flex flex-col gap-1 text-sm">
                  {plan.features.map((feature, i) => (
                    <li key={i} className={`flex items-start gap-2 ${feature.included ? '' : 'opacity-60'}`}>
                      {feature.included ? (
                        <CheckIcon aria-label="Included" className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <XIcon aria-label="Not included" className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span>{feature.text}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={!buyable}
                  tabIndex={-1}
                  className="mt-auto rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: look.mainColor }}
                >
                  {buyable ? look.buttonText : words.unavailable}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
