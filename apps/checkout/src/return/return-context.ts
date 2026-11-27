import type { CheckoutPayment } from '../shared/api.js';
import type { Language } from '../shared/i18n.js';

// The return page's rules, kept pure: what the checkout page puts in the
// (short) return URL it gives a redirect gateway, what the Payment's status means to
// the Customer, and where they go next. Nothing in the return URL is proof
// of payment: the outcome comes only from the API's Payment status.

/**
 * What the return URL carries: just enough to call the API and greet the
 * Customer. It stays short (a gateway may cap its return URL's length); the
 * host page and snippet URLs, which can be long, are kept with the checkout
 * session and read back from the API (`ReturnTargets`).
 */
export interface ReturnLink {
  readonly paymentId: string;
  readonly publishableKey: string;
  /** The host page's origin, which the API checks against the key. */
  readonly hostOrigin: string;
  /** The Pricing Table's language. */
  readonly language: Language;
}

/** Where the Customer started and the snippet's URLs, from the API. */
export interface ReturnTargets {
  /** The host page the Customer started from. */
  readonly hostPageUrl: string;
  /** The snippet's `data-success-url` / `data-cancel-url` (null: unset). */
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
}

const PARAMS = {
  paymentId: 'paymentId',
  publishableKey: 'key',
  hostOrigin: 'origin',
  language: 'lang',
} as const;

/** An http(s) URL, or false. */
export function isWebUrl(value: string | null | undefined): value is string {
  return !!value && URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

/** An http(s) origin and nothing more (no path, query or hash). */
function isWebOrigin(value: string | null): value is string {
  return isWebUrl(value) && new URL(value).origin === value;
}

/** The return URL for a redirect gateway: `<checkout>/return?...`. */
export function returnPageUrl(checkoutUrl: string, link: ReturnLink): string {
  const url = new URL('/return', checkoutUrl);
  url.searchParams.set(PARAMS.paymentId, link.paymentId);
  url.searchParams.set(PARAMS.publishableKey, link.publishableKey);
  url.searchParams.set(PARAMS.hostOrigin, link.hostOrigin);
  url.searchParams.set(PARAMS.language, link.language);
  return url.toString();
}

/**
 * The link back from the return page's URL, or null when it cannot be used.
 * Gateways add their own parameters to it; those are ignored.
 */
export function readReturnLink(url: URL): ReturnLink | null {
  const get = (name: string) => url.searchParams.get(name)?.trim() || null;
  const paymentId = get(PARAMS.paymentId);
  const publishableKey = get(PARAMS.publishableKey);
  const hostOrigin = get(PARAMS.hostOrigin);
  if (!paymentId || !publishableKey || !isWebOrigin(hostOrigin)) return null;
  return {
    paymentId,
    publishableKey,
    hostOrigin,
    language: get(PARAMS.language) === 'vi' ? 'vi' : 'en',
  };
}

/**
 * The Payment's return context from the API, or the host origin's home page
 * when the checkout page sent none.
 */
export function returnTargetsOf(link: ReturnLink, sent: ReturnTargets | null): ReturnTargets {
  return sent ?? { hostPageUrl: `${link.hostOrigin}/`, successUrl: null, cancelUrl: null };
}

/** What the Customer is told. */
export type ReturnOutcome = 'succeeded' | 'cancelled' | 'expired' | 'notCompleted' | 'processing';

/** Attempt statuses meaning the Customer's attempt ended without paying. */
const ENDED_UNPAID = new Set(['FAILED', 'CANCELLED', 'EXPIRED']);

/**
 * The outcome from the Payment's status. An open Payment whose latest attempt
 * ended unpaid (the Customer gave up on the gateway's page) is "not
 * completed"; any other open Payment is still processing.
 */
export function outcomeOf(payment: Pick<CheckoutPayment, 'status' | 'attempt'>): ReturnOutcome {
  switch (payment.status) {
    case 'SUCCEEDED':
      return 'succeeded';
    case 'CANCELLED':
      return 'cancelled';
    case 'EXPIRED':
      return 'expired';
    default:
      return payment.attempt && ENDED_UNPAID.has(payment.attempt.status)
        ? 'notCompleted'
        : 'processing';
  }
}

/** The Pricing Plan's URLs, from the API. */
export interface PlanReturnUrls {
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
}

/**
 * Where the Customer goes after the outcome: the snippet's URL, else the
 * Pricing Plan's, else the host page they started from. URLs that came
 * through the browser (the snippet's and the host page) count only on an
 * origin the Publishable Key allows, so the return page is no open redirect.
 * Null while processing, or when there is nowhere safe to go.
 */
export function forwardTarget(
  outcome: ReturnOutcome,
  context: ReturnTargets,
  plan: PlanReturnUrls,
  allowedOrigins: readonly string[],
): string | null {
  if (outcome === 'processing') return null;
  const allowed = (url: string | null | undefined): url is string =>
    isWebUrl(url) && allowedOrigins.includes(new URL(url).origin);
  const [snippetUrl, planUrl] =
    outcome === 'succeeded'
      ? [context.successUrl, plan.successUrl]
      : [context.cancelUrl, plan.cancelUrl];
  if (allowed(snippetUrl)) return snippetUrl;
  if (isWebUrl(planUrl)) return planUrl;
  return allowed(context.hostPageUrl) ? context.hostPageUrl : null;
}
