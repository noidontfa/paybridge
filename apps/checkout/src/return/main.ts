import {
  checkoutApi,
  CheckoutRequestError,
  CheckoutUnavailableError,
  type CheckoutApi,
  type CheckoutPayment,
} from '../shared/api.js';
import { h } from '../shared/dom.js';
import { strings, type Strings } from '../shared/i18n.js';
import {
  forwardTarget,
  outcomeOf,
  readReturnContext,
  type ReturnContext,
  type ReturnOutcome,
} from './return-context.js';

// The return page: where a redirect gateway sends the Customer back, on the
// checkout app's own origin, at the top level. It reads the Payment's status
// from the API (never from the gateway's query parameters), shows the
// outcome in the Pricing Table's language, and forwards the Customer to the
// success or cancel URL, or back to the host page they started from.

interface PageConfig {
  readonly apiUrl: string;
}

const LOG_PREFIX = '[PayBridge]';
const POLL_INTERVAL_MS = 2_000;
/** How long the page keeps asking before it stops and says so. */
const POLL_FOR_MS = 5 * 60_000;
/** How long the outcome shows before the Customer is forwarded. */
const FORWARD_AFTER_MS = 2_500;

const app = document.getElementById('app')!;
const config = JSON.parse(document.getElementById('paybridge-config')!.textContent!) as PageConfig;

function show(...children: (Node | false | null | undefined)[]): void {
  app.replaceChildren(...children.filter((c): c is Node => Boolean(c)));
}

const link = (href: string, text: string, primary = false) =>
  h('a', { class: primary ? 'button primary' : 'button', href, 'data-testid': 'forward' }, text);

const TITLES: Record<Exclude<ReturnOutcome, 'processing'>, (t: Strings) => [string, string]> = {
  succeeded: (t) => [t.succeeded, t.succeededBody],
  cancelled: (t) => [t.cancelled, t.cancelledBody],
  expired: (t) => [t.expired, t.expiredBody],
  notCompleted: (t) => [t.notCompleted, t.notCompletedBody],
};

class ReturnPage {
  private readonly t: Strings;
  private readonly startedAt = Date.now();
  private requeried = false;

  constructor(
    private readonly api: CheckoutApi,
    private readonly context: ReturnContext,
  ) {
    this.t = strings(context.language);
  }

  async start(): Promise<void> {
    show(h('p', { class: 'muted' }, this.t.loading));
    try {
      const [payment, allowedOrigins] = await Promise.all([
        this.api.payment(this.context.paymentId),
        this.api.frameAncestors(),
      ]);
      await this.follow(payment, allowedOrigins);
    } catch (error) {
      this.fail(error);
    }
  }

  private async follow(first: CheckoutPayment, allowedOrigins: readonly string[]): Promise<void> {
    let payment = first;
    for (;;) {
      const outcome = outcomeOf(payment);
      if (outcome !== 'processing') return this.finish(outcome, payment, allowedOrigins);
      this.requery(payment);
      if (Date.now() - this.startedAt > POLL_FOR_MS) return this.stillProcessing(allowedOrigins, true);
      this.stillProcessing(allowedOrigins, false);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        payment = await this.api.payment(this.context.paymentId);
      } catch (error) {
        if (error instanceof CheckoutUnavailableError) throw error;
        // A transient failure: keep asking.
      }
    }
  }

  /**
   * Asks Payment Core, once, to query the gateway for the attempt (its
   * browser-return route), so a missed callback does not leave the Customer
   * waiting. The answer is not read; the status is polled as usual.
   */
  private requery(payment: CheckoutPayment): void {
    if (this.requeried || !payment.attempt) return;
    this.requeried = true;
    const url = new URL(
      `/api/payments/${encodeURIComponent(payment.id)}/return`,
      config.apiUrl,
    );
    url.searchParams.set('attemptId', payment.attempt.id);
    void fetch(url, { mode: 'no-cors', credentials: 'omit' }).catch(() => undefined);
  }

  private stillProcessing(allowedOrigins: readonly string[], gaveUp: boolean): void {
    const back = this.hostPage(allowedOrigins);
    show(
      h(
        'section',
        { class: 'result', 'data-result': 'PROCESSING' },
        h('h1', {}, this.t.returnProcessing),
        h('p', { class: 'muted' }, gaveUp ? this.t.processingTooLong : this.t.processingBody),
        gaveUp && back ? link(back, this.t.backToShop) : null,
      ),
    );
  }

  private finish(
    outcome: Exclude<ReturnOutcome, 'processing'>,
    payment: CheckoutPayment,
    allowedOrigins: readonly string[],
  ): void {
    const [title, body] = TITLES[outcome](this.t);
    const target = forwardTarget(outcome, this.context, payment.returnUrls, allowedOrigins);
    show(
      h(
        'section',
        { class: 'result', 'data-result': payment.status, 'data-outcome': outcome },
        h('h1', {}, title),
        h('p', { class: 'muted' }, body),
        target ? h('p', { class: 'muted' }, this.t.forwarding) : null,
        target ? link(target, this.t.continue, true) : null,
      ),
    );
    if (target) setTimeout(() => window.location.replace(target), FORWARD_AFTER_MS);
  }

  private hostPage(allowedOrigins: readonly string[]): string | null {
    const url = this.context.hostPageUrl;
    return allowedOrigins.includes(new URL(url).origin) ? url : null;
  }

  private fail(error: unknown): void {
    const reason =
      error instanceof CheckoutUnavailableError
        ? error.reason
        : error instanceof CheckoutRequestError
          ? error.code
          : 'UNEXPECTED_ERROR';
    console.warn(`${LOG_PREFIX} Could not read the Payment. Reason: ${reason}`);
    show(h('p', { class: 'notice', role: 'status', 'data-testid': 'unavailable' }, this.t.tryAgainLater));
  }
}

function boot(): void {
  const context = readReturnContext(new URL(window.location.href));
  if (!context) {
    console.warn(`${LOG_PREFIX} The return page was opened without a checkout Payment.`);
    show(h('p', { class: 'notice' }, strings('en').unavailable));
    return;
  }
  document.documentElement.lang = context.language;
  const api = checkoutApi({
    apiUrl: config.apiUrl,
    publishableKey: context.publishableKey,
    hostOrigin: new URL(context.hostPageUrl).origin,
  });
  void new ReturnPage(api, context).start();
}

boot();
