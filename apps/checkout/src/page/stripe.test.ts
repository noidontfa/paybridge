// @vitest-environment jsdom
import type { CheckoutAttempt, NextAction } from '../shared/api.js';
import { strings } from '../shared/i18n.js';
import { clientSdkView, type ConfirmResult, type StripeJs } from './stripe.js';

// The CLIENT_SDK NextAction (ADR 0003): the page loads Stripe.js with the
// attempt's clientParams, mounts the Payment Element and confirms in the
// iframe. Stripe.js itself is replaced by a stand-in; nothing reaches Stripe.

const ACTION = {
  type: 'CLIENT_SDK',
  token: 'pi_123_secret_abc',
  clientParams: {
    publishableKey: 'pk_test_123',
    returnUrl: 'https://checkout.paybridge.test/return?paymentId=p-1',
  },
} as const satisfies NextAction;

const ATTEMPT: CheckoutAttempt = {
  id: 'attempt-1',
  gatewayId: 'stripe',
  status: 'PENDING',
  nextAction: ACTION,
};
const t = strings('en');

class FakeStripe implements StripeJs {
  readonly loadedWith: string[] = [];
  elementsOptions: unknown;
  mountedOn: HTMLElement | null = null;
  readonly confirmations: unknown[] = [];
  readonly results: ConfirmResult[] = [];
  private onReady: (() => void) | undefined;

  load = (publishableKey: string) => {
    this.loadedWith.push(publishableKey);
    return Promise.resolve(this as StripeJs);
  };

  elements(options: unknown) {
    this.elementsOptions = options;
    return {
      create: (type: 'payment') => {
        expect(type).toBe('payment');
        return {
          mount: (el: HTMLElement) => {
            this.mountedOn = el;
          },
          on: (event: 'ready', handler: () => void) => {
            if (event === 'ready') this.onReady = handler;
          },
        };
      },
    };
  }

  confirmPayment(options: unknown) {
    this.confirmations.push(options);
    return Promise.resolve(this.results.shift() ?? {});
  }

  ready() {
    this.onReady?.();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const payButton = (view: HTMLElement) =>
  [...view.querySelectorAll('button')].find((b) => b.textContent === t.payNow)!;

async function mounted(stripe: FakeStripe, action: NextAction = ACTION) {
  const view = clientSdkView(stripe.load)(action, { attempt: ATTEMPT, t });
  document.body.replaceChildren(view);
  await flush();
  stripe.ready();
  return view;
}

describe('the client SDK NextAction', () => {
  it("mounts Stripe's Payment Element with the attempt's publishable key and client secret", async () => {
    const stripe = new FakeStripe();

    const view = await mounted(stripe);

    expect(view.dataset.nextAction).toBe('CLIENT_SDK');
    expect(stripe.loadedWith).toEqual(['pk_test_123']);
    expect(stripe.elementsOptions).toMatchObject({ clientSecret: 'pi_123_secret_abc' });
    expect(view.contains(stripe.mountedOn)).toBe(true);
    expect(payButton(view).disabled).toBe(false);
  });

  it('confirms in the iframe, returning through the return URL only when the card needs it', async () => {
    const stripe = new FakeStripe();
    stripe.results.push({ paymentIntent: { status: 'succeeded' } });
    const view = await mounted(stripe);

    payButton(view).click();
    await flush();

    expect(stripe.confirmations).toEqual([
      {
        elements: expect.anything(),
        confirmParams: { return_url: ACTION.clientParams.returnUrl },
        redirect: 'if_required',
      },
    ]);
    expect(view.textContent).toContain(t.processing);
  });

  it('keeps the Customer on the same attempt after a decline, so they can retry', async () => {
    const stripe = new FakeStripe();
    stripe.results.push(
      { error: { type: 'card_error', message: 'Your card was declined.' } },
      { paymentIntent: { status: 'processing' } },
    );
    const view = await mounted(stripe);

    payButton(view).click();
    await flush();

    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Your card was declined.');
    expect(view.contains(stripe.mountedOn)).toBe(true);
    expect(payButton(view).disabled).toBe(false);

    payButton(view).click();
    await flush();

    expect(stripe.confirmations).toHaveLength(2);
    expect(view.textContent).toContain(t.processing);
  });

  it('says the method is not available when the NextAction lacks a publishable key', async () => {
    const stripe = new FakeStripe();

    const view = await mounted(stripe, { type: 'CLIENT_SDK', token: 'pi_secret', clientParams: {} });

    expect(view.textContent).toContain(t.methodNotSupported);
    expect(stripe.loadedWith).toEqual([]);
  });

  it('asks the Customer to try again (or another method) when Stripe.js does not load', async () => {
    const view = clientSdkView(() => Promise.reject(new Error('blocked')))(ACTION, {
      attempt: ATTEMPT,
      t,
    });
    await flush();

    expect(view.querySelector('[role="alert"]')?.textContent).toBe(t.tryAgainLater);
  });
});
