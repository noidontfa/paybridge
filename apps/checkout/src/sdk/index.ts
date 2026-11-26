import {
  checkoutApi,
  CheckoutUnavailableError,
  type PricingTable,
  type PricingTablePlan,
} from '../shared/api.js';
import { h } from '../shared/dom.js';
import { languageOf, type Language } from '../shared/i18n.js';
import { renderCards, renderUnavailable, shadowStyles } from './cards.js';
import { openCheckoutModal } from './modal.js';
import { readSnippet, type Snippet } from './snippet.js';

// PayBridge Embedded Checkout SDK, loaded by the snippet:
//   <script src="https://<checkout app>/v1/paybridge.js" data-key="pb_pk_…" data-table="…"></script>
//
// It draws the Pricing Table's cards where the script tag is, inside a Shadow
// DOM, and opens the PayBridge checkout page in a modal iframe when a Pricing
// Plan is picked.
//
// Callbacks and events: `data-on-success`, `data-on-cancel` and `data-on-error`
// name global functions, called with `{ paymentId }` (and `reason` for
// errors); the same detail is dispatched as the DOM events `paybridge:success`,
// `paybridge:cancel` and `paybridge:error`, which bubble from the element the
// cards are drawn in. They are for display only. NEVER unlock a purchase from
// them: anyone can call them from the browser console. Grant access when your
// server receives the signed `payment.succeeded` Webhook.

declare const __PAYBRIDGE_CONFIG__: { checkoutUrl: string; apiUrl: string; version: string };

const CONFIG = __PAYBRIDGE_CONFIG__;
const LOG_PREFIX = '[PayBridge]';

type Outcome = 'success' | 'cancel' | 'error';

interface OutcomeDetail {
  readonly paymentId: string | null;
  readonly reason?: string;
}

function emitter(mount: HTMLElement, snippet: Snippet) {
  const names = {
    success: snippet.callbacks.onSuccess,
    cancel: snippet.callbacks.onCancel,
    error: snippet.callbacks.onError,
  };
  return (outcome: Outcome, detail: OutcomeDetail): void => {
    mount.dispatchEvent(
      new CustomEvent(`paybridge:${outcome}`, { detail, bubbles: true, composed: true }),
    );
    const name = names[outcome];
    if (!name) return;
    const callback = (window as unknown as Record<string, unknown>)[name];
    if (typeof callback !== 'function') {
      console.warn(`${LOG_PREFIX} data-on-${outcome}="${name}" is not a global function.`);
      return;
    }
    try {
      (callback as (detail: OutcomeDetail) => void)(detail);
    } catch (error) {
      console.error(`${LOG_PREFIX} The ${name} callback threw.`, error);
    }
  };
}

function unavailable(reason: string): void {
  console.warn(`${LOG_PREFIX} Payment is not available right now. Reason: ${reason}`);
}

function startCheckout(
  snippet: Snippet,
  table: PricingTable,
  plan: PricingTablePlan,
  emit: ReturnType<typeof emitter>,
): void {
  let paymentId: string | null = null;
  let settled = false;
  openCheckoutModal({
    checkoutUrl: CONFIG.checkoutUrl,
    publishableKey: snippet.key,
    language: table.language,
    init: {
      type: 'init',
      tableId: table.id,
      planId: plan.id,
      language: table.language,
      ...(snippet.customerReference ? { customerReference: snippet.customerReference } : {}),
      ...(snippet.successUrl ? { successUrl: snippet.successUrl } : {}),
      ...(snippet.cancelUrl ? { cancelUrl: snippet.cancelUrl } : {}),
    },
    onMessage: (message) => {
      switch (message.type) {
        case 'payment':
          paymentId = message.paymentId;
          break;
        case 'success':
          settled = true;
          emit('success', { paymentId: message.paymentId });
          break;
        case 'cancel':
          settled = true;
          emit('cancel', { paymentId: message.paymentId });
          break;
        case 'error':
          settled = true;
          unavailable(message.reason);
          emit('error', { paymentId: message.paymentId, reason: message.reason });
          break;
        default:
          break;
      }
    },
    onClose: () => {
      // Closing before the Payment ended is giving up for now; reopening
      // resumes the same open Payment.
      if (!settled) emit('cancel', { paymentId });
    },
    onTimeout: () => {
      settled = true;
      unavailable('CHECKOUT_PAGE_UNAVAILABLE');
      emit('error', { paymentId, reason: 'CHECKOUT_PAGE_UNAVAILABLE' });
    },
  });
}

async function mountSnippet(script: HTMLScriptElement): Promise<void> {
  const mount = h('div', { 'data-paybridge-pricing-table': true });
  script.after(mount);
  const shadow = mount.attachShadow({ mode: 'open' });
  shadow.append(shadowStyles());
  const fallbackLanguage: Language = languageOf(document.documentElement.lang);

  const read = readSnippet(script);
  if (!read.ok) {
    unavailable(read.reason);
    shadow.append(renderUnavailable(fallbackLanguage));
    return;
  }
  const snippet = read.snippet;
  const emit = emitter(mount, snippet);
  const api = checkoutApi({ apiUrl: CONFIG.apiUrl, publishableKey: snippet.key });

  let table: PricingTable;
  try {
    table = await api.pricingTable(snippet.tableId);
  } catch (error) {
    const reason = error instanceof CheckoutUnavailableError ? error.reason : 'API_UNREACHABLE';
    unavailable(reason);
    shadow.append(renderUnavailable(fallbackLanguage));
    emit('error', { paymentId: null, reason });
    return;
  }
  for (const plan of table.plans) {
    if (!plan.buyable) {
      console.info(`${LOG_PREFIX} "${plan.name}" cannot be bought now. Reason: ${plan.unavailableReason}`);
    }
  }
  shadow.append(
    renderCards(table, (plan) => {
      if (plan.buyable) startCheckout(snippet, table, plan, emit);
    }),
  );
}

const current = document.currentScript;
if (current instanceof HTMLScriptElement) {
  void mountSnippet(current);
} else {
  console.warn(`${LOG_PREFIX} Load paybridge.js with a plain <script> tag (not a module).`);
}
(window as unknown as { PayBridge?: object }).PayBridge = { version: CONFIG.version };
