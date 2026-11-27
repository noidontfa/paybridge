import type { CheckoutPayment } from '../shared/api.js';
import type { Language } from '../shared/i18n.js';

// The return page's rules, kept pure: what the checkout page puts in the
// return URL it gives a redirect gateway, what the Payment's status means to
// the Customer, and where they go next. Nothing in the return URL is proof
// of payment: the outcome comes only from the API's Payment status.

/** What the checkout page knows and the return page needs back. */
export interface ReturnContext {
  readonly paymentId: string;
  readonly publishableKey: string;
  /** The host page the Customer started from; its origin is the host origin. */
  readonly hostPageUrl: string;
  /** The Pricing Table's language. */
  readonly language: Language;
  /** The snippet's `data-success-url` / `data-cancel-url`. */
  readonly successUrl?: string;
  readonly cancelUrl?: string;
}

const PARAMS = {
  paymentId: 'paymentId',
  publishableKey: 'key',
  hostPageUrl: 'back',
  language: 'lang',
  successUrl: 'success',
  cancelUrl: 'cancel',
} as const;

/** An http(s) URL, or false. */
export function isWebUrl(value: string | null | undefined): value is string {
  return !!value && URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

/** The return URL for a redirect gateway: `<checkout>/return?…`. */
export function returnPageUrl(checkoutUrl: string, context: ReturnContext): string {
  const url = new URL('/return', checkoutUrl);
  url.searchParams.set(PARAMS.paymentId, context.paymentId);
  url.searchParams.set(PARAMS.publishableKey, context.publishableKey);
  url.searchParams.set(PARAMS.hostPageUrl, context.hostPageUrl);
  url.searchParams.set(PARAMS.language, context.language);
  if (context.successUrl) url.searchParams.set(PARAMS.successUrl, context.successUrl);
  if (context.cancelUrl) url.searchParams.set(PARAMS.cancelUrl, context.cancelUrl);
  return url.toString();
}

/**
 * The context back from the return page's URL, or null when it cannot be
 * used. Gateways add their own parameters to it; those are ignored.
 */
export function readReturnContext(url: URL): ReturnContext | null {
  const get = (name: string) => url.searchParams.get(name)?.trim() || null;
  const paymentId = get(PARAMS.paymentId);
  const publishableKey = get(PARAMS.publishableKey);
  const hostPageUrl = get(PARAMS.hostPageUrl);
  if (!paymentId || !publishableKey || !isWebUrl(hostPageUrl)) return null;
  const successUrl = get(PARAMS.successUrl);
  const cancelUrl = get(PARAMS.cancelUrl);
  return {
    paymentId,
    publishableKey,
    hostPageUrl,
    language: get(PARAMS.language) === 'vi' ? 'vi' : 'en',
    ...(isWebUrl(successUrl) ? { successUrl } : {}),
    ...(isWebUrl(cancelUrl) ? { cancelUrl } : {}),
  };
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
  context: ReturnContext,
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
