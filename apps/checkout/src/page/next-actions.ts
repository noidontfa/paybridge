import QRCode from 'qrcode';
import type { CheckoutAttempt, NextAction } from '../shared/api.js';
import { h } from '../shared/dom.js';
import type { Strings } from '../shared/i18n.js';
import { clientSdkView } from './stripe.js';

// How the checkout page shows each NextAction kind. Adding a kind means adding
// one view here:
// - QR_CODE: drawn here; the page polls the Payment until it ends.
// - REDIRECT: a link that takes the whole tab to the gateway's page. The
//   return page it comes back to is ticket 10's.
// - CLIENT_SDK (Stripe.js, ADR 0003): the Payment Element, in `stripe.ts`.

export interface NextActionContext {
  readonly attempt: CheckoutAttempt;
  readonly t: Strings;
}

export type View = (action: NextAction, context: NextActionContext) => HTMLElement;

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

const redirect: View = (action, { t }) => {
  const url = (action as Extract<NextAction, { type: 'REDIRECT' }>).url;
  const safe = URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
  return h(
    'section',
    { 'data-next-action': 'REDIRECT' },
    safe
      ? h('a', { class: 'button primary', href: url, target: '_top', rel: 'noopener' }, t.continueToGateway)
      : h('p', { class: 'notice' }, t.methodNotSupported),
  );
};

const unsupported: View = (action, { t }) =>
  h('section', { 'data-next-action': action.type }, h('p', { class: 'notice' }, t.methodNotSupported));

const VIEWS: Record<string, View> = {
  QR_CODE: qrCode,
  REDIRECT: redirect,
  CLIENT_SDK: clientSdkView(),
};

export function nextActionView(action: NextAction, context: NextActionContext): HTMLElement {
  return (VIEWS[action.type] ?? unsupported)(action, context);
}
