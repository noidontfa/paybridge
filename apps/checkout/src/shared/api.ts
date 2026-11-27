// The API's public checkout endpoints (`/api/checkout/...`): the only API the
// checkout app calls. Every call carries the Publishable Key. From the
// checkout app's origin it also names the host page it acts for.

import type { Language } from './i18n.js';

export type NextAction =
  | { readonly type: 'REDIRECT'; readonly url: string }
  | { readonly type: 'QR_CODE'; readonly payload: string }
  | {
      readonly type: 'CLIENT_SDK';
      readonly token: string;
      readonly clientParams?: Readonly<Record<string, string>>;
    }
  | { readonly type: string };

export interface PricingTablePlan {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly features: readonly { readonly text: string; readonly included: boolean }[];
  readonly amount: string;
  readonly currency: string;
  readonly recommended: boolean;
  readonly gateways: readonly { readonly id: string }[];
  readonly buyable: boolean;
  readonly unavailableReason: string | null;
}

export interface PricingTable {
  readonly id: string;
  readonly mainColor: string;
  readonly theme: 'light' | 'dark';
  readonly language: Language;
  readonly buttonText: string;
  readonly plans: readonly PricingTablePlan[];
}

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'CANCELLED' | 'EXPIRED';

export interface CheckoutAttempt {
  readonly id: string;
  readonly gatewayId: string;
  readonly status: string;
  readonly nextAction: NextAction | null;
}

export interface CheckoutPayment {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly currency: string;
  readonly expiresAt: string;
  readonly pricingPlan: { readonly id: string; readonly name: string } | null;
  /** The Pricing Plan's success and cancel URLs (null: not set). */
  readonly returnUrls: { readonly successUrl: string | null; readonly cancelUrl: string | null };
  readonly attempt: CheckoutAttempt | null;
  readonly resumed?: boolean;
}

/** The generic "cannot sell": the Customer sees one message, the reason is for developers. */
export class CheckoutUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Payment is not available right now (${reason})`);
    this.name = 'CheckoutUnavailableError';
  }
}

/** Any other refusal or failure (network, 4xx, 5xx). */
export class CheckoutRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Checkout request failed: ${status} ${code}`);
    this.name = 'CheckoutRequestError';
  }
}

export interface CheckoutApiOptions {
  /** The API's base URL, e.g. `https://api.paybridge.example` (no `/api`). */
  readonly apiUrl: string;
  readonly publishableKey: string;
  /** Set from the checkout app: the host page the iframe is embedded in. */
  readonly hostOrigin?: string;
  readonly fetch?: typeof fetch;
}

export interface StartPaymentInput {
  readonly pricingPlanId: string;
  readonly sessionToken: string;
  readonly customerReference?: string;
}

export interface CheckoutApi {
  pricingTable(id: string): Promise<PricingTable>;
  startPayment(input: StartPaymentInput): Promise<CheckoutPayment>;
  payment(id: string): Promise<CheckoutPayment>;
  startAttempt(
    paymentId: string,
    input: { readonly gatewayId: string; readonly returnUrl: string },
  ): Promise<{ attempt: CheckoutAttempt; payment: CheckoutPayment }>;
  /** The origins allowed to frame the checkout page (server side only). */
  frameAncestors(): Promise<readonly string[]>;
}

export function checkoutApi(options: CheckoutApiOptions): CheckoutApi {
  const base = `${options.apiUrl.replace(/\/+$/, '')}/api/checkout`;
  const doFetch = options.fetch ?? ((...args) => fetch(...args));

  async function call<T>(path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.publishableKey}`,
      Accept: 'application/json',
    };
    if (options.hostOrigin) headers['X-PayBridge-Host-Origin'] = options.hostOrigin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        credentials: 'omit',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new CheckoutRequestError(0, 'NETWORK_ERROR');
    }
    const json = (await response.json().catch(() => null)) as {
      code?: unknown;
      details?: { reason?: unknown };
    } | null;
    if (response.ok) return json as T;
    if (response.status === 422 && json?.code === 'CHECKOUT_UNAVAILABLE') {
      const reason = json.details?.reason;
      throw new CheckoutUnavailableError(typeof reason === 'string' ? reason : 'UNKNOWN');
    }
    throw new CheckoutRequestError(
      response.status,
      typeof json?.code === 'string' ? json.code : 'HTTP_ERROR',
    );
  }

  const id = (value: string) => encodeURIComponent(value);
  return {
    pricingTable: (tableId) => call(`/pricing-tables/${id(tableId)}`),
    startPayment: (input) => call('/payments', input),
    payment: (paymentId) => call(`/payments/${id(paymentId)}`),
    startAttempt: (paymentId, input) => call(`/payments/${id(paymentId)}/attempts`, input),
    frameAncestors: async () =>
      (await call<{ allowedOrigins: string[] }>('/frame')).allowedOrigins,
  };
}
