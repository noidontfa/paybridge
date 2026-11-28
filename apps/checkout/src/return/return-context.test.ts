import type { CheckoutPayment } from '../shared/api.js';
import {
  forwardTarget,
  outcomeOf,
  readReturnLink,
  returnPageUrl,
  returnTargetsOf,
  type ReturnLink,
  type ReturnTargets,
} from './return-context.js';

// What the return page knows when a gateway sends the Customer back: the
// short link the checkout page put in the return URL, the return context and
// status of the Payment from the API, and where that sends the Customer.

const CHECKOUT = 'https://checkout.paybridge.example';
const SHOP = 'https://shop.example.com';

const link: ReturnLink = {
  paymentId: '019a2b3c-4d5e-7f00-8a00-0000000000aa',
  publishableKey: 'pb_pk_test_key',
  hostOrigin: SHOP,
  language: 'vi',
};

const context: ReturnTargets = {
  hostPageUrl: `${SHOP}/pricing?plan=pro`,
  successUrl: `${SHOP}/thanks`,
  cancelUrl: `${SHOP}/sorry`,
};

describe('the return URL', () => {
  it("is the checkout app's /return page, carrying the link back", () => {
    const url = new URL(returnPageUrl(CHECKOUT, link));

    expect(url.origin + url.pathname).toBe(`${CHECKOUT}/return`);
    expect([...url.searchParams.keys()].sort()).toEqual(['key', 'lang', 'origin', 'paymentId']);
    expect(readReturnLink(url)).toEqual(link);
  });

  it('stays short however long the host page and snippet URLs are', () => {
    // They are kept with the checkout session, not in the URL.
    const longest = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}:65535`;
    const url = returnPageUrl(CHECKOUT, { ...link, hostOrigin: longest });

    expect(url.length).toBeLessThan(512);
    expect(readReturnLink(new URL(url))?.hostOrigin).toBe(longest);
  });

  it.each([
    ['no Payment id', 'paymentId'],
    ['no key', 'key'],
    ['no host origin', 'origin'],
  ])('is refused with %s', (_, param) => {
    const url = new URL(returnPageUrl(CHECKOUT, link));
    url.searchParams.delete(param);

    expect(readReturnLink(url)).toBeNull();
  });

  it.each(['javascript:alert(1)', `${SHOP}/pricing`, 'not a url'])(
    'is refused when the host origin is %s',
    (origin) => {
      const url = new URL(returnPageUrl(CHECKOUT, link));
      url.searchParams.set('origin', origin);

      expect(readReturnLink(url)).toBeNull();
    },
  );

  it('reads an unknown language as English', () => {
    const url = new URL(returnPageUrl(CHECKOUT, link));
    url.searchParams.set('lang', 'fr');

    expect(readReturnLink(url)?.language).toBe('en');
  });
});

describe('the return context', () => {
  it('is what the checkout page sent with the attempt', () => {
    expect(returnTargetsOf(link, context)).toEqual(context);
  });

  it("is the host origin's home page when none was sent", () => {
    expect(returnTargetsOf(link, null)).toEqual({
      hostPageUrl: `${SHOP}/`,
      successUrl: null,
      cancelUrl: null,
    });
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
    const bare = { ...context, successUrl: null, cancelUrl: null };

    expect(forwardTarget('succeeded', bare, plan, allowed)).toBe('https://plan.example/thanks');
    expect(forwardTarget('cancelled', bare, plan, allowed)).toBe('https://plan.example/pricing');
  });

  it('falls back to the host page the Customer started from', () => {
    const bare = { ...context, successUrl: null, cancelUrl: null };

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
