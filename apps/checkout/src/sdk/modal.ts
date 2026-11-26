import { h } from '../shared/dom.js';
import { strings, type Language } from '../shared/i18n.js';
import {
  fromSdk,
  readCheckoutMessage,
  type CheckoutMessage,
  type SdkMessage,
} from '../shared/messages.js';

// The modal holding the PayBridge checkout page in an iframe. It talks to the
// page only through postMessage: it accepts messages from that iframe's
// window and the checkout app's origin only, and sends only to that origin.

const STYLES = `
:host { all: initial; }
.pb-backdrop { position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center;
  justify-content: center; background: rgba(17, 24, 39, .6); padding: 16px; }
.pb-dialog { position: relative; width: 100%; max-width: 480px; height: min(640px, 100%);
  background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
.pb-dialog iframe { width: 100%; height: 100%; border: 0; display: block; }
.pb-close { position: absolute; top: 8px; right: 8px; z-index: 1; width: 32px; height: 32px;
  border-radius: 999px; border: 0; background: rgba(0,0,0,.06); cursor: pointer; font: 20px/1 system-ui; }
.pb-message { padding: 48px 24px; text-align: center; font: 15px/1.5 system-ui, sans-serif; color: #6b7280; }
`;

/** How long the checkout page has to say it is ready before we give up. */
const READY_TIMEOUT_MS = 15_000;

export interface CheckoutModalOptions {
  readonly checkoutUrl: string;
  readonly publishableKey: string;
  readonly language: Language;
  /** Sent to the page once it is ready. */
  readonly init: Extract<SdkMessage, { type: 'init' }>;
  readonly onMessage: (message: CheckoutMessage) => void;
  /** The Customer closed the modal (button, Escape, or the page's "Done"). */
  readonly onClose: () => void;
  /** The page never answered: refused to load (CSP) or unreachable. */
  readonly onTimeout: () => void;
}

export interface CheckoutModal {
  close(): void;
}

export function openCheckoutModal(options: CheckoutModalOptions): CheckoutModal {
  const checkoutOrigin = new URL(options.checkoutUrl).origin;
  const src = new URL('/checkout', checkoutOrigin);
  src.searchParams.set('key', options.publishableKey);
  src.searchParams.set('hostOrigin', window.location.origin);

  const t = strings(options.language);
  const host = h('div', { 'data-paybridge-modal': true });
  const shadow = host.attachShadow({ mode: 'open' });
  const iframe = h('iframe', {
    src: src.toString(),
    title: 'PayBridge Checkout',
    allow: 'payment',
    referrerpolicy: 'origin',
  });
  const closeButton = h('button', { class: 'pb-close', type: 'button', 'aria-label': t.close }, '×');
  const dialog = h('div', { class: 'pb-dialog', role: 'dialog', 'aria-modal': 'true' }, closeButton, iframe);
  shadow.append(h('style', {}, STYLES), h('div', { class: 'pb-backdrop' }, dialog));
  document.body.append(host);

  let open = true;
  let ready = false;

  function close(): void {
    if (!open) return;
    open = false;
    clearTimeout(timeout);
    window.removeEventListener('message', onWindowMessage);
    document.removeEventListener('keydown', onKey);
    host.remove();
    options.onClose();
  }

  function onWindowMessage(event: MessageEvent): void {
    const message = readCheckoutMessage(event, {
      origin: checkoutOrigin,
      source: iframe.contentWindow,
    });
    if (!message) return;
    if (message.type === 'ready') {
      ready = true;
      clearTimeout(timeout);
      iframe.contentWindow?.postMessage(fromSdk(options.init), checkoutOrigin);
      return;
    }
    if (message.type === 'close') {
      close();
      return;
    }
    options.onMessage(message);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  const timeout = setTimeout(() => {
    if (ready || !open) return;
    iframe.remove();
    dialog.append(h('p', { class: 'pb-message', role: 'status' }, t.unavailable));
    options.onTimeout();
  }, READY_TIMEOUT_MS);

  closeButton.addEventListener('click', close);
  window.addEventListener('message', onWindowMessage);
  document.addEventListener('keydown', onKey);
  closeButton.focus();

  return { close };
}
