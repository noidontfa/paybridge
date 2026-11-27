import QRCode from 'qrcode';
import type { CheckoutAttempt, NextAction } from '../shared/api.js';
import { h } from '../shared/dom.js';
import type { Strings } from '../shared/i18n.js';

// How the checkout page shows each NextAction kind. Adding a kind means adding
// one view here:
// - QR_CODE: drawn here; the page polls the Payment until it ends.
// - REDIRECT: takes the whole tab to the gateway's page at once when the
//   Customer has just chosen the gateway, else (a resumed attempt) offers a
//   link. The gateway sends them back to the return page (src/return/).
// - CLIENT_SDK (Stripe.js, ADR 0003): ticket 11 mounts the provider's form.

export interface NextActionContext {
  readonly attempt: CheckoutAttempt;
  readonly t: Strings;
  /** The Customer just chose this gateway (not a resumed attempt). */
  readonly fresh?: boolean;
}

type View = (action: NextAction, context: NextActionContext) => HTMLElement;

const qrCode: View = (action, { t }) => {
  const payload = (action as Extract<NextAction, { type: 'QR_CODE' }>).payload;
  const holder = h('div', { class: 'qr', 'data-qr-payload': payload, role: 'img', 'aria-label': t.scanQr });
  void QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    holder.append(document.importNode(parsed, true));
  });
  return h(
    'section',
    { 'data-next-action': 'QR_CODE' },
    h('p', {}, t.scanQr),
    holder,
    h('p', { class: 'muted' }, t.waiting),
  );
};

const redirect: View = (action, { t, fresh }) => {
  const url = (action as Extract<NextAction, { type: 'REDIRECT' }>).url;
  const safe = URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
  if (!safe) {
    return h('section', { 'data-next-action': 'REDIRECT' }, h('p', { class: 'notice' }, t.methodNotSupported));
  }
  // The Customer's click lets this frame navigate the top window; the link
  // stays as a fallback if the browser refuses.
  if (fresh) queueMicrotask(() => leaveFor(url));
  return h(
    'section',
    { 'data-next-action': 'REDIRECT' },
    fresh ? h('p', { class: 'muted' }, t.redirectingToGateway) : null,
    h('a', { class: 'button primary', href: url, target: '_top', rel: 'noopener' }, t.continueToGateway),
  );
};

/** Takes the whole tab (not just the modal) to the gateway's page. */
function leaveFor(url: string): void {
  try {
    window.top!.location.href = url;
  } catch (error) {
    console.warn('[PayBridge] Could not leave for the payment page; use the link.', error);
  }
}

const unsupported: View = (action, { t }) =>
  h('section', { 'data-next-action': action.type }, h('p', { class: 'notice' }, t.methodNotSupported));

const VIEWS: Record<string, View> = {
  QR_CODE: qrCode,
  REDIRECT: redirect,
  // CLIENT_SDK: ticket 11.
};

export function nextActionView(action: NextAction, context: NextActionContext): HTMLElement {
  return (VIEWS[action.type] ?? unsupported)(action, context);
}
