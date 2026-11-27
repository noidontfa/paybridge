import {
  checkoutApi,
  CheckoutRequestError,
  CheckoutUnavailableError,
  type CheckoutApi,
  type CheckoutAttempt,
  type CheckoutPayment,
  type PricingTable,
  type PricingTablePlan,
} from '../shared/api.js';
import { h } from '../shared/dom.js';
import { formatAmount, gatewayName, strings, type Language } from '../shared/i18n.js';
import {
  fromCheckoutPage,
  readSdkMessage,
  type CheckoutMessage,
  type SdkMessage,
} from '../shared/messages.js';
import { readEmail } from './email.js';
import { nextActionView } from './next-actions.js';
import { checkoutSessionToken } from './session-token.js';

// The checkout page, inside the PayBridge iframe the SDK opens. It talks to
// the host page only through postMessage (with the host origin named in its
// URL, which the API checks against the Publishable Key), and to the API's
// public checkout endpoints only.

interface PageConfig {
  readonly checkoutUrl: string;
  readonly apiUrl: string;
  readonly version: string;
}

const LOG_PREFIX = '[PayBridge]';
/** How often the page asks whether the Payment has ended. */
const POLL_INTERVAL_MS = 2_000;
const OPEN_ATTEMPT = new Set(['CREATED', 'PENDING']);

const app = document.getElementById('app')!;
const config = JSON.parse(document.getElementById('paybridge-config')!.textContent!) as PageConfig;
const params = new URL(window.location.href).searchParams;
const key = params.get('key');
const hostOrigin = validOrigin(params.get('hostOrigin'));

function validOrigin(value: string | null): string | null {
  return value && URL.canParse(value) && new URL(value).origin === value ? value : null;
}

function show(...children: (Node | false | null | undefined)[]): void {
  app.replaceChildren(...children.filter((c): c is Node => Boolean(c)));
}

function post(message: CheckoutMessage): void {
  if (hostOrigin) window.parent.postMessage(fromCheckoutPage(message), hostOrigin);
}

function applyTheme(table: Pick<PricingTable, 'theme' | 'mainColor' | 'language'>): void {
  const root = document.documentElement;
  root.lang = table.language;
  root.dataset.theme = table.theme;
  if (/^#[0-9a-fA-F]{6}$/.test(table.mainColor)) root.style.setProperty('--pb-main', table.mainColor);
}

/** Where a gateway sends the Customer back after a redirect (ticket 10's page). */
function returnUrlFor(paymentId: string): string {
  const url = new URL('/return', config.checkoutUrl);
  url.searchParams.set('paymentId', paymentId);
  return url.toString();
}

class Checkout {
  private language: Language;
  private payment: CheckoutPayment | null = null;
  private plan: PricingTablePlan | null = null;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private finished = false;
  /** The attempt the Customer is looking at; a failure of it sends them back to the choice. */
  private shownAttemptId: string | null = null;

  constructor(
    private readonly api: CheckoutApi,
    private readonly init: SdkMessage,
  ) {
    this.language = init.language;
  }

  private get t() {
    return strings(this.language);
  }

  async start(): Promise<void> {
    show(h('p', { class: 'muted' }, this.t.loading));
    try {
      const table = await this.api.pricingTable(this.init.tableId);
      this.language = table.language;
      applyTheme(table);
      const plan = table.plans.find((p) => p.id === this.init.planId);
      if (!plan) throw new CheckoutUnavailableError('PRICING_PLAN_NOT_FOUND');
      if (!plan.buyable) {
        throw new CheckoutUnavailableError(plan.unavailableReason ?? 'PRICING_PLAN_UNAVAILABLE');
      }
      this.plan = plan;
      if (this.init.askEmail) {
        this.askEmail();
        return;
      }
      await this.startPayment();
    } catch (error) {
      this.fail(error);
    }
  }

  /** `data-ask-email`: the Customer's email comes first; nothing is started without a valid one. */
  private askEmail(notice?: string, typed = ''): void {
    const t = this.t;
    const input = h('input', {
      id: 'customer-email',
      type: 'email',
      name: 'email',
      autocomplete: 'email',
      inputmode: 'email',
      required: true,
      maxlength: '254',
      'aria-invalid': notice ? 'true' : undefined,
      'aria-describedby': notice ? 'customer-email-error' : undefined,
    });
    input.value = typed;
    const submit = h('button', { type: 'submit', class: 'primary' }, t.continue);
    // `novalidate`: the page checks with the API's own rule and says why in the page's language.
    const form = h(
      'form',
      { class: 'email', novalidate: true },
      h('label', { for: 'customer-email' }, t.emailLabel),
      input,
      notice ? h('p', { class: 'notice', role: 'alert', id: 'customer-email-error' }, notice) : null,
      submit,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = readEmail(input.value);
      if (!email) {
        this.askEmail(t.emailInvalid, input.value);
        return;
      }
      submit.disabled = true;
      void this.startPayment(email).catch((error: unknown) => {
        if (error instanceof CheckoutRequestError && error.status === 400) {
          this.askEmail(t.emailInvalid, input.value);
        } else {
          this.fail(error);
        }
      });
    });
    show(this.header(), h('p', {}, t.emailPrompt), form);
    input.focus();
  }

  private async startPayment(customerEmail?: string): Promise<void> {
    const payment = await this.api.startPayment({
      pricingPlanId: this.plan!.id,
      sessionToken: checkoutSessionToken(() => window.localStorage),
      ...(this.init.customerReference ? { customerReference: this.init.customerReference } : {}),
      ...(customerEmail ? { customerEmail } : {}),
    });
    this.payment = payment;
    post({ type: 'payment', paymentId: payment.id });
    const attempt = payment.attempt;
    if (attempt && OPEN_ATTEMPT.has(attempt.status) && attempt.nextAction) {
      this.showAttempt(attempt);
    } else {
      this.showChoice();
    }
    this.schedulePoll();
  }

  /** The Pricing Plan and its Amount: the Payment's once started, the plan's before. */
  private header(): HTMLElement {
    const payment = this.payment;
    const plan = this.plan!;
    return h(
      'header',
      {},
      h('h1', { 'data-testid': 'plan-name' }, payment?.pricingPlan?.name ?? plan.name),
      h(
        'p',
        { class: 'amount', 'data-testid': 'amount' },
        formatAmount(payment?.amount ?? plan.amount, payment?.currency ?? plan.currency, this.language),
      ),
    );
  }

  private showChoice(notice?: string): void {
    this.shownAttemptId = null;
    const buttons = this.plan!.gateways.map((gateway) => {
      const button = h(
        'button',
        { type: 'button', 'data-gateway-id': gateway.id },
        gatewayName(gateway.id),
      );
      button.addEventListener('click', () => void this.choose(gateway.id, buttons));
      return button;
    });
    show(
      this.header(),
      notice ? h('p', { class: 'notice', role: 'alert' }, notice) : null,
      h('p', {}, this.t.chooseMethod),
      h('div', { class: 'methods', role: 'group', 'aria-label': this.t.chooseMethod }, ...buttons),
    );
  }

  private async choose(gatewayId: string, buttons: HTMLButtonElement[]): Promise<void> {
    for (const b of buttons) b.disabled = true;
    try {
      const { attempt, payment } = await this.api.startAttempt(this.payment!.id, {
        gatewayId,
        returnUrl: returnUrlFor(this.payment!.id),
      });
      this.payment = payment;
      if (this.settle(payment)) return;
      if (attempt.status === 'FAILED' || !attempt.nextAction) {
        this.showChoice(this.t.attemptFailed);
        return;
      }
      this.showAttempt(attempt);
    } catch (error) {
      if (error instanceof CheckoutUnavailableError) return this.fail(error);
      console.warn(`${LOG_PREFIX} Could not start the attempt.`, error);
      this.showChoice(this.t.tryAgainLater);
    }
  }

  private showAttempt(attempt: CheckoutAttempt): void {
    this.shownAttemptId = attempt.id;
    const other = h('button', { type: 'button', 'data-testid': 'switch-gateway' }, this.t.otherMethod);
    other.addEventListener('click', () => this.showChoice());
    show(
      this.header(),
      h(
        'p',
        { class: 'muted', 'data-testid': 'gateway' },
        gatewayName(attempt.gatewayId),
      ),
      nextActionView(attempt.nextAction!, { attempt, t: this.t }),
      other,
    );
  }

  private schedulePoll(): void {
    clearTimeout(this.poll);
    if (this.finished) return;
    this.poll = setTimeout(() => void this.refresh(), POLL_INTERVAL_MS);
  }

  private async refresh(): Promise<void> {
    try {
      const payment = await this.api.payment(this.payment!.id);
      this.payment = payment;
      if (this.settle(payment)) return;
      const attempt = payment.attempt;
      if (
        this.shownAttemptId &&
        attempt?.id === this.shownAttemptId &&
        !OPEN_ATTEMPT.has(attempt.status)
      ) {
        this.showChoice(this.t.attemptFailed);
      }
    } catch (error) {
      if (error instanceof CheckoutUnavailableError) return this.fail(error);
      // A transient failure: keep polling.
    }
    this.schedulePoll();
  }

  /** Shows the result once the Payment has ended; true if it has. */
  private settle(payment: CheckoutPayment): boolean {
    if (payment.status === 'PENDING') return false;
    this.finished = true;
    clearTimeout(this.poll);
    const t = this.t;
    const [title, body] =
      payment.status === 'SUCCEEDED'
        ? [t.succeeded, t.succeededBody]
        : payment.status === 'EXPIRED'
          ? [t.expired, t.expiredBody]
          : [t.cancelled, t.cancelledBody];
    const done = h('button', { type: 'button', class: 'primary' }, t.done);
    done.addEventListener('click', () => post({ type: 'close' }));
    show(
      h(
        'section',
        { class: 'result', 'data-result': payment.status },
        h('h1', {}, title),
        h('p', { class: 'muted' }, body),
        done,
      ),
    );
    post(
      payment.status === 'SUCCEEDED'
        ? { type: 'success', paymentId: payment.id }
        : { type: 'cancel', paymentId: payment.id },
    );
    return true;
  }

  private fail(error: unknown): void {
    this.finished = true;
    clearTimeout(this.poll);
    const reason =
      error instanceof CheckoutUnavailableError
        ? error.reason
        : error instanceof CheckoutRequestError
          ? error.code
          : 'UNEXPECTED_ERROR';
    console.warn(`${LOG_PREFIX} Payment is not available right now. Reason: ${reason}`);
    show(h('p', { class: 'notice', role: 'status', 'data-testid': 'unavailable' }, this.t.unavailable));
    post({ type: 'error', paymentId: this.payment?.id ?? null, reason });
  }
}

function boot(): void {
  if (!key || !hostOrigin || window.parent === window) {
    console.warn(`${LOG_PREFIX} The checkout page must be opened by paybridge.js.`);
    show(h('p', { class: 'notice' }, strings('en').unavailable));
    return;
  }
  const api = checkoutApi({ apiUrl: config.apiUrl, publishableKey: key, hostOrigin });
  let started = false;
  window.addEventListener('message', (event) => {
    const message = readSdkMessage(event, { origin: hostOrigin, source: window.parent });
    if (!message || started) return;
    started = true;
    void new Checkout(api, message).start();
  });
  show(h('p', { class: 'muted' }, strings('en').loading));
  post({ type: 'ready' });
}

boot();
