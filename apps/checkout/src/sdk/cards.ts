import type { PricingTable, PricingTablePlan } from '../shared/api.js';
import { h } from '../shared/dom.js';
import { formatAmount, strings, type Language } from '../shared/i18n.js';

// The price cards, drawn inside the SDK's Shadow DOM. `:host { all: initial }`
// resets everything the host page's styles could pass down by inheritance.

const STYLES = `
:host { all: initial; display: block; }
* { box-sizing: border-box; }
.pb-root { --pb-main: #4f46e5; --pb-bg: #ffffff; --pb-card: #ffffff; --pb-fg: #111827;
  --pb-muted: #6b7280; --pb-border: #e5e7eb;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--pb-fg); }
.pb-root[data-theme="dark"] { --pb-bg: #0b1120; --pb-card: #111827; --pb-fg: #f9fafb;
  --pb-muted: #9ca3af; --pb-border: #374151; }
.pb-table { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; padding: 16px;
  background: var(--pb-bg); border-radius: 12px; }
.pb-card { position: relative; flex: 1 1 220px; max-width: 320px; padding: 24px; border-radius: 12px;
  background: var(--pb-card); border: 1px solid var(--pb-border); display: flex; flex-direction: column; }
.pb-card[data-recommended] { border: 2px solid var(--pb-main); }
.pb-badge { position: absolute; top: -12px; left: 24px; padding: 2px 10px; border-radius: 999px;
  background: var(--pb-main); color: #fff; font-size: 12px; font-weight: 600; }
.pb-name { margin: 0; font-size: 18px; font-weight: 700; }
.pb-description { margin: 4px 0 12px; color: var(--pb-muted); }
.pb-price { margin: 0 0 16px; font-size: 28px; font-weight: 800; }
.pb-features { list-style: none; margin: 0 0 20px; padding: 0; flex: 1; }
.pb-feature { display: flex; gap: 8px; padding: 2px 0; }
.pb-feature[data-included="false"] { color: var(--pb-muted); }
.pb-mark { width: 1.2em; font-weight: 700; }
.pb-feature[data-included="true"] .pb-mark { color: var(--pb-main); }
.pb-buy { display: block; width: 100%; padding: 12px; border: 0; border-radius: 8px; cursor: pointer;
  background: var(--pb-main); color: #fff; font: inherit; font-weight: 600; }
.pb-buy:disabled { cursor: not-allowed; opacity: .5; }
.pb-unavailable { margin: 8px 0 0; color: var(--pb-muted); font-size: 13px; text-align: center; }
.pb-message { padding: 16px; text-align: center; color: var(--pb-muted); }
`;

export function shadowStyles(): HTMLStyleElement {
  return h('style', {}, STYLES);
}

function themed(table: Pick<PricingTable, 'theme' | 'mainColor'>, child: Node): HTMLElement {
  const root = h('div', { class: 'pb-root', 'data-theme': table.theme }, child);
  if (/^#[0-9a-fA-F]{6}$/.test(table.mainColor)) {
    root.style.setProperty('--pb-main', table.mainColor);
  }
  return root;
}

function card(table: PricingTable, plan: PricingTablePlan, onBuy: (plan: PricingTablePlan) => void) {
  const t = strings(table.language);
  const buy = h(
    'button',
    { class: 'pb-buy', type: 'button', disabled: !plan.buyable },
    table.buttonText,
  );
  buy.addEventListener('click', () => onBuy(plan));
  return h(
    'article',
    {
      class: 'pb-card',
      'data-plan-id': plan.id,
      'data-recommended': plan.recommended,
      'aria-label': plan.name,
    },
    plan.recommended && h('span', { class: 'pb-badge' }, t.recommended),
    h('h3', { class: 'pb-name' }, plan.name),
    plan.description && h('p', { class: 'pb-description' }, plan.description),
    h('p', { class: 'pb-price' }, formatAmount(plan.amount, plan.currency, table.language)),
    h(
      'ul',
      { class: 'pb-features' },
      ...plan.features.map((feature) =>
        h(
          'li',
          { class: 'pb-feature', 'data-included': String(feature.included) },
          h(
            'span',
            {
              class: 'pb-mark',
              role: 'img',
              'aria-label': feature.included ? t.included : t.notIncluded,
            },
            feature.included ? '✓' : '✗',
          ),
          h('span', {}, feature.text),
        ),
      ),
    ),
    buy,
    !plan.buyable && h('p', { class: 'pb-unavailable' }, t.unavailable),
  );
}

/** The Pricing Table's cards, one per Pricing Plan, in the table's order. */
export function renderCards(
  table: PricingTable,
  onBuy: (plan: PricingTablePlan) => void,
): HTMLElement {
  return themed(
    table,
    h('div', { class: 'pb-table' }, ...table.plans.map((plan) => card(table, plan, onBuy))),
  );
}

/** "Payment is not available right now", when the table cannot be shown. */
export function renderUnavailable(language: Language): HTMLElement {
  return themed(
    { theme: 'light', mainColor: '' },
    h('p', { class: 'pb-message', role: 'status' }, strings(language).unavailable),
  );
}
