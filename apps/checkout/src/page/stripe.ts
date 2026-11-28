import type { NextAction } from '../shared/api.js';
import { h } from '../shared/dom.js';
import type { View } from './next-actions.js';

// The CLIENT_SDK NextAction (ADR 0003): Stripe.js and its Payment Element,
// inside the PayBridge iframe, so card details go only to Stripe. The attempt's
// `token` is the PaymentIntent's client secret and its `clientParams` carry the
// Organization's publishable key and the return URL for 3-D Secure.
//
// A decline does not end the attempt (the plugin reports PENDING): the form
// stays, shows Stripe's message, and the Customer retries on the same
// PaymentIntent. A confirmed payment is reported by Stripe's webhook; the page
// keeps polling the Payment until it ends.

/** Where Stripe requires Stripe.js to be loaded from (never bundled). */
export const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

/** The part of Stripe.js the page uses. */
export interface StripeJs {
  elements(options: {
    clientSecret: string;
    appearance?: Record<string, unknown>;
    locale?: string;
  }): {
    create(type: 'payment'): {
      mount(element: HTMLElement): void;
      on(event: 'ready', handler: () => void): void;
    };
  };
  confirmPayment(options: {
    elements: unknown;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }): Promise<ConfirmResult>;
}

export interface ConfirmResult {
  readonly error?: { readonly type: string; readonly message?: string };
  readonly paymentIntent?: { readonly status: string };
}

export type StripeLoader = (publishableKey: string) => Promise<StripeJs>;

type StripeFactory = (publishableKey: string) => StripeJs;

let script: Promise<StripeFactory> | undefined;

/** Loads Stripe.js once from js.stripe.com (allowed by the page's CSP). */
export const loadStripeJs: StripeLoader = async (publishableKey) => {
  script ??= new Promise<StripeFactory>((resolve, reject) => {
    const loaded = () => (window as unknown as { Stripe?: StripeFactory }).Stripe;
    const existing = loaded();
    if (existing) return resolve(existing);
    const tag = h('script', { src: STRIPE_JS_URL, async: true });
    tag.addEventListener('load', () => {
      const factory = loaded();
      if (factory) resolve(factory);
      else reject(new Error('Stripe.js loaded without defining Stripe'));
    });
    tag.addEventListener('error', () => reject(new Error('Stripe.js could not be loaded')));
    document.head.append(tag);
  }).catch((error: unknown) => {
    script = undefined;
    throw error;
  });
  return (await script)(publishableKey);
};

const LOG_PREFIX = '[PayBridge]';

/** The page's theme, handed to the Payment Element so it matches. */
function appearance(): Record<string, unknown> {
  const root = document.documentElement;
  const main = root.style.getPropertyValue('--pb-main').trim();
  return {
    theme: root.dataset.theme === 'dark' ? 'night' : 'stripe',
    ...(main ? { variables: { colorPrimary: main } } : {}),
  };
}

export function clientSdkView(loadStripe: StripeLoader = loadStripeJs): View {
  return (action, { t }) => {
    const { token, clientParams } = action as Extract<NextAction, { type: 'CLIENT_SDK' }>;
    const publishableKey = clientParams?.publishableKey;
    const section = h('section', { 'data-next-action': 'CLIENT_SDK', class: 'client-sdk' });
    if (!token || !publishableKey?.startsWith('pk_')) {
      section.append(h('p', { class: 'notice' }, t.methodNotSupported));
      return section;
    }
    const returnUrl = clientParams?.returnUrl ?? window.location.href;

    const form = h('div', { 'data-stripe-element': true });
    const message = h('p', { class: 'notice', role: 'alert', hidden: true });
    const pay = h('button', { type: 'button', class: 'primary', disabled: true }, t.payNow);
    section.append(form, message, pay);

    const say = (text: string | null) => {
      message.textContent = text ?? '';
      message.hidden = text === null;
    };

    void loadStripe(publishableKey)
      .then((stripe) => {
        const elements = stripe.elements({ clientSecret: token, appearance: appearance(), locale: 'auto' });
        const element = elements.create('payment');
        element.on('ready', () => {
          pay.disabled = false;
        });
        element.mount(form);

        pay.addEventListener('click', () => {
          pay.disabled = true;
          say(null);
          void stripe
            .confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: 'if_required' })
            .then((result) => {
              if (result.error) {
                // A decline or an invalid card: same attempt, try again.
                say(result.error.message ?? t.tryAgainLater);
                pay.disabled = false;
                return;
              }
              section.replaceChildren(h('p', { class: 'muted', role: 'status' }, t.processing));
            })
            .catch((error: unknown) => {
              console.warn(`${LOG_PREFIX} Stripe could not confirm the payment.`, error);
              say(t.tryAgainLater);
              pay.disabled = false;
            });
        });
      })
      .catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} Stripe.js is not available.`, error);
        say(t.tryAgainLater);
      });
    return section;
  };
}
