import type { CheckoutPayment } from '../shared/api.js';
import {
  forwardTarget,
  outcomeOf,
  readReturnContext,
  returnPageUrl,
  type ReturnContext,
} from './return-context.js';

// What the return page knows when a gateway sends the Customer back: the
// context the checkout page put in the return URL, the Payment's status from
// the API, and where that sends the Customer.

const CHECKOUT = 'https://checkout.paybridge.example';
const SHOP = 'https://shop.example.com';

const context: ReturnContext = {
  paymentId: '019a2b3c-4d5e-7f00-8a00-0000000000aa',
  publishableKey: 'pb_pk_test_key',
  hostPageUrl: `${SHOP}/pricing?plan=pro`,
  language: 'vi',
  successUrl: `${SHOP}/thanks`,
  cancelUrl: `${SHOP}/sorry`,
};

describe('the return URL', () => {
  it('is the checkout app\'s /return page, carrying the context back', () => {
    const url = new URL(returnPageUrl(CHECKOUT, context));

    expect(url.origin + url.pathname).toBe(`${CHECKOUT}/return`);
    expect(readReturnContext(url)).toEqual(context);
  });

  it('leaves out the snippet URLs it was not given', () => {
    const minimal: ReturnContext = {
      paymentId: context.paymentId,
      publishableKey: context.publishableKey,
      hostPageUrl: `${SHOP}/`,
      language: 'en',
    };
    const url = new URL(returnPageUrl(CHECKOUT, minimal));

    expect([...url.searchParams.keys()].sort()).toEqual(['back', 'key', 'lang', 'paymentId']);
    expect(readReturnContext(url)).toEqual(minimal);
  });

  it.each([
    ['no Payment id', 'paymentId'],
    ['no key', 'key'],
    ['no host page', 'back'],
  ])('is refused with %s', (_, param) => {
    const url = new URL(returnPageUrl(CHECKOUT, context));
    url.searchParams.delete(param);

    expect(readReturnContext(url)).toBeNull();
  });

  it('is refused when the host page is not a web page', () => {
    const url = new URL(returnPageUrl(CHECKOUT, context));
    url.searchParams.set('back', 'javascript:alert(1)');

    expect(readReturnContext(url)).toBeNull();
  });

  it('drops snippet URLs that are not web pages, and an unknown language', () => {
    const url = new URL(returnPageUrl(CHECKOUT, context));
    url.searchParams.set('success', 'javascript:alert(1)');
    url.searchParams.set('lang', 'fr');

    const read = readReturnContext(url)!;
    expect(read.successUrl).toBeUndefined();
    expect(read.cancelUrl).toBe(`${SHOP}/sorry`);
    expect(read.language).toBe('en');
  });
});

function payment(
  status: CheckoutPayment['status'],
  attemptStatus: string | null = 'PENDING',
): Pick<CheckoutPayment, 'status' | 'attempt'> {
  return {
    status,
    attempt: attemptStatus
      ? { id: 'a1', gatewayId: 'fake', status: attemptStatus, nextAction: null }
      : null,
  };
}

describe('the outcome shown', () => {
  it.each([
    ['SUCCEEDED', 'SUCCEEDED', 'succeeded'],
    ['CANCELLED', 'CANCELLED', 'cancelled'],
    ['EXPIRED', 'EXPIRED', 'expired'],
  ] as const)('is the Payment\'s own when it is %s', (status, attempt, outcome) => {
    expect(outcomeOf(payment(status, attempt))).toBe(outcome);
  });

  it.each(['FAILED', 'CANCELLED', 'EXPIRED'])(
    'is "not completed" when the Payment is open but the attempt ended %s',
    (attempt) => {
      expect(outcomeOf(payment('PENDING', attempt))).toBe('notCompleted');
    },
  );

  it.each(['CREATED', 'PENDING', 'REQUIRES_REVIEW', null])(
    'is "still processing" while the attempt is %s',
    (attempt) => {
      expect(outcomeOf(payment('PENDING', attempt))).toBe('processing');
    },
  );

  it('is "still processing" for an open Payment even after an attempt reported success', () => {
    // Only the Payment's status counts; a succeeded attempt is settled by Core.
    expect(outcomeOf(payment('PENDING', 'SUCCEEDED'))).toBe('processing');
  });
});

describe('where the Customer is sent', () => {
  const plan = { successUrl: 'https://plan.example/thanks', cancelUrl: 'https://plan.example/pricing' };
  const none = { successUrl: null, cancelUrl: null };
  const allowed = [SHOP];

  it('prefers the snippet\'s success URL after a success', () => {
    expect(forwardTarget('succeeded', context, plan, allowed)).toBe(`${SHOP}/thanks`);
  });

  it.each(['cancelled', 'expired', 'notCompleted'] as const)(
    'prefers the snippet\'s cancel URL when %s',
    (outcome) => {
      expect(forwardTarget(outcome, context, plan, allowed)).toBe(`${SHOP}/sorry`);
    },
  );

  it('uses the Pricing Plan\'s URLs when the snippet sets none', () => {
    const bare = { ...context, successUrl: undefined, cancelUrl: undefined };

    expect(forwardTarget('succeeded', bare, plan, allowed)).toBe('https://plan.example/thanks');
    expect(forwardTarget('cancelled', bare, plan, allowed)).toBe('https://plan.example/pricing');
  });

  it('falls back to the host page the Customer started from', () => {
    const bare = { ...context, successUrl: undefined, cancelUrl: undefined };

    expect(forwardTarget('succeeded', bare, none, allowed)).toBe(`${SHOP}/pricing?plan=pro`);
    expect(forwardTarget('expired', bare, none, allowed)).toBe(`${SHOP}/pricing?plan=pro`);
  });

  it('ignores snippet URLs and a host page outside the key\'s allowed origins', () => {
    const forged = {
      ...context,
      successUrl: 'https://evil.example/phish',
      hostPageUrl: 'https://evil.example/',
    };

    expect(forwardTarget('succeeded', forged, plan, allowed)).toBe('https://plan.example/thanks');
    expect(forwardTarget('succeeded', forged, none, allowed)).toBeNull();
  });

  it('sends nobody anywhere while the Payment is still processing', () => {
    expect(forwardTarget('processing', context, plan, allowed)).toBeNull();
  });
});
