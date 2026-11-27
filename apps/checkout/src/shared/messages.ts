// The postMessage protocol between the SDK (on the host page) and the
// checkout page (in the PayBridge iframe). Nothing else crosses the frame.
// Each side accepts a message only from the exact origin and window it
// expects, and only in a known shape; anything else is ignored.

import type { Language } from './i18n.js';

const SDK = 'paybridge-sdk';
const CHECKOUT = 'paybridge-checkout';

/** SDK -> checkout page. */
export type SdkMessage = {
  readonly type: 'init';
  readonly tableId: string;
  readonly planId: string;
  /** The Pricing Table's language, for messages shown before it is read. */
  readonly language: Language;
  readonly customerReference?: string;
  /** `data-ask-email`: ask the Customer for an email before starting the Payment. */
  readonly askEmail?: boolean;
  /** Snippet URLs (`data-success-url`, `data-cancel-url`), for the return page. */
  readonly successUrl?: string;
  readonly cancelUrl?: string;
  /** The host page the Customer started from; the return page's last resort. */
  readonly hostPageUrl?: string;
};

/** Checkout page -> SDK. */
export type CheckoutMessage =
  /** The page is listening; the SDK answers with `init`. */
  | { readonly type: 'ready' }
  /** A Payment was started or resumed. */
  | { readonly type: 'payment'; readonly paymentId: string }
  | { readonly type: 'success'; readonly paymentId: string }
  /** The Payment ended without success (cancelled or expired). */
  | { readonly type: 'cancel'; readonly paymentId: string }
  /** Nothing can be sold; `reason` is for the developer console only. */
  | {
      readonly type: 'error';
      readonly paymentId: string | null;
      readonly reason: string;
    }
  /** The Customer asked to close the window. */
  | { readonly type: 'close' };

export type Envelope<M> = M & { readonly source: string };

export const fromSdk = (message: SdkMessage): Envelope<SdkMessage> => ({
  ...message,
  source: SDK,
});

export const fromCheckoutPage = (
  message: CheckoutMessage,
): Envelope<CheckoutMessage> => ({ ...message, source: CHECKOUT });

/** Who a message must come from: the window and its origin. */
export interface Sender {
  readonly origin: string;
  readonly source: unknown;
}

type Fields = Record<string, unknown>;

function envelope(event: MessageEvent, from: Sender, tag: string): Fields | null {
  if (event.origin !== from.origin || event.source !== from.source) return null;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Fields;
  return fields.source === tag ? fields : null;
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === 'string';

/** The SDK's view: a message from its own checkout iframe, or null. */
export function readCheckoutMessage(
  event: MessageEvent,
  from: Sender,
): CheckoutMessage | null {
  const m = envelope(event, from, CHECKOUT);
  if (!m) return null;
  switch (m.type) {
    case 'ready':
    case 'close':
      return { type: m.type };
    case 'payment':
    case 'success':
    case 'cancel':
      return isString(m.paymentId) ? { type: m.type, paymentId: m.paymentId } : null;
    case 'error':
      return isString(m.reason) && (m.paymentId === null || isString(m.paymentId))
        ? { type: 'error', paymentId: m.paymentId, reason: m.reason }
        : null;
    default:
      return null;
  }
}

/** The checkout page's view: a message from the host page's SDK, or null. */
export function readSdkMessage(event: MessageEvent, from: Sender): SdkMessage | null {
  const m = envelope(event, from, SDK);
  if (!m || m.type !== 'init') return null;
  if (!isString(m.tableId) || !isString(m.planId)) return null;
  if (m.language !== 'vi' && m.language !== 'en') return null;
  if (
    !isOptionalString(m.customerReference) ||
    !isOptionalString(m.successUrl) ||
    !isOptionalString(m.cancelUrl) ||
    !isOptionalString(m.hostPageUrl) ||
    (m.askEmail !== undefined && typeof m.askEmail !== 'boolean')
  ) {
    return null;
  }
  return {
    type: 'init',
    tableId: m.tableId,
    planId: m.planId,
    language: m.language,
    ...(m.customerReference ? { customerReference: m.customerReference } : {}),
    ...(m.askEmail ? { askEmail: true } : {}),
    ...(m.successUrl ? { successUrl: m.successUrl } : {}),
    ...(m.cancelUrl ? { cancelUrl: m.cancelUrl } : {}),
    ...(m.hostPageUrl ? { hostPageUrl: m.hostPageUrl } : {}),
  };
}
