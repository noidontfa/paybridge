import Stripe from 'stripe';
import {
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  InvalidCallbackError,
  OutcomeUnknownError,
  type CallbackInput,
  type CallbackResult,
  type CancelInput,
  type CancelResult,
  type GatewayCapabilities,
  type InitiateInput,
  type InitiateResult,
  type NormalizedStatus,
  type PaymentGateway,
  type QueryInput,
  type QueryResult,
} from '../../payment-core/port/index.js';

export const STRIPE_GATEWAY_ID = 'stripe';

/** Pinned so a Stripe account-level upgrade never changes our payloads. */
export const STRIPE_API_VERSION = '2026-11-18.endive';

export interface StripeGatewayOptions {
  readonly secretKey: string;
  readonly publishableKey: string;
  /** Signing secret of the webhook endpoint (`whsec_…`). */
  readonly webhookSecret: string;
  /** Replaces the SDK's HTTP layer; tests use it to replay recorded responses. */
  readonly httpClient?: Stripe.HttpClient;
  /** Network retries performed by the SDK, reusing the idempotency key. Default 2. */
  readonly maxNetworkRetries?: number;
}

const WEBHOOK_TOLERANCE_SECONDS = 300;
const SUCCESS_ACK = { httpStatus: 200, body: '' } as const;
const ERROR_ACK = { httpStatus: 400, body: '' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_STATUS_MAP: Readonly<Record<string, NormalizedStatus | undefined>> = {
  'payment_intent.succeeded': 'SUCCEEDED',
  'payment_intent.payment_failed': 'PENDING',
  'payment_intent.processing': 'PENDING',
  'payment_intent.canceled': 'FAILED',
};

type Operation = 'initiate' | 'query' | 'cancel';

const STATUS_MAP: Readonly<Record<Stripe.PaymentIntent.Status, NormalizedStatus>> = {
  succeeded: 'SUCCEEDED',
  canceled: 'FAILED',
  requires_payment_method: 'PENDING',
  requires_confirmation: 'PENDING',
  requires_action: 'PENDING',
  processing: 'PENDING',
  requires_capture: 'REQUIRES_REVIEW',
};

/**
 * Stripe through PaymentIntent + Stripe.js (cards, automatic capture, VND).
 * Depends only on Core's port.
 */
export class StripeGatewayPlugin implements PaymentGateway {
  readonly gatewayId = STRIPE_GATEWAY_ID;
  readonly capabilities: GatewayCapabilities = { supportsCancel: true };
  readonly callbackHeaders = ['stripe-signature'] as const;

  private readonly stripe: Stripe;
  private readonly publishableKey: string;
  private readonly webhookSecret: string;
  private readonly livemode: boolean;

  constructor(options: StripeGatewayOptions) {
    this.publishableKey = options.publishableKey;
    this.webhookSecret = options.webhookSecret;
    this.livemode = /^(sk|rk)_live_/.test(options.secretKey);
    this.stripe = new Stripe(options.secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: options.maxNetworkRetries ?? 2,
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    });
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const amount = toIntegerAmount(input.amount);
    const intent = await this.call('initiate', () =>
      this.stripe.paymentIntents.create(
        {
          amount,
          // The port's GatewayCurrency is VND only, so input.currency is always VND.
          currency: 'vnd',
          allowed_payment_method_types: ['card'],
          capture_method: 'automatic',
          description: input.description,
          metadata: { attemptKey: input.attemptKey },
        },
        { idempotencyKey: input.attemptKey },
      ),
    );
    if (!intent.client_secret) {
      // Stripe created the PaymentIntent but gave us nothing to hand the
      // frontend. It exists, so this is not a rejection: Core re-queries it.
      throw new OutcomeUnknownError(
        `PaymentIntent ${intent.id} was created without a client secret`,
      );
    }
    return {
      providerRef: intent.id,
      nextAction: {
        type: 'CLIENT_SDK',
        token: intent.client_secret,
        clientParams: {
          publishableKey: this.publishableKey,
          returnUrl: input.returnUrl,
        },
      },
      providerMetadata: {
        paymentIntentId: intent.id,
        livemode: intent.livemode,
      },
      rawPayload: withoutClientSecret(intent),
    };
  }

  async query(input: QueryInput): Promise<QueryResult> {
    const paymentIntentId = input.providerMetadata['paymentIntentId'];
    const intent = await this.call('query', () =>
      typeof paymentIntentId === 'string'
        ? this.stripe.paymentIntents.retrieve(paymentIntentId)
        : this.searchByAttemptKey(input.attemptKey),
    );
    return {
      status: STATUS_MAP[intent.status],
      amount: intent.status === 'succeeded' ? String(intent.amount_received) : null,
      rawCode: intent.status,
      providerRef: intent.id,
      rawPayload: withoutClientSecret(intent),
    };
  }

  readonly cancel = async (input: CancelInput): Promise<CancelResult> => {
    const paymentIntentId = input.providerMetadata['paymentIntentId'];
    if (typeof paymentIntentId !== 'string') {
      throw new GatewayNotFoundError('No PaymentIntent id to cancel');
    }
    const intent = await this.call('cancel', async () => {
      try {
        return await this.stripe.paymentIntents.cancel(paymentIntentId, undefined, {
          idempotencyKey: `${input.attemptKey}:cancel`,
        });
      } catch (error) {
        const already = alreadyCancelled(error);
        if (already) return already;
        throw error;
      }
    });
    return { rawPayload: withoutClientSecret(intent) };
  };

  async parseCallback(input: CallbackInput): Promise<CallbackResult> {
    const event = this.verify(input);
    const status = EVENT_STATUS_MAP[event.type];
    if (status === undefined || event.livemode !== this.livemode) {
      return { ignored: true, ack: SUCCESS_ACK };
    }
    const intent = event.data.object as Stripe.PaymentIntent;
    const attemptKey = intent.metadata?.['attemptKey'];
    if (attemptKey === undefined || !UUID.test(attemptKey)) {
      return { ignored: true, ack: SUCCESS_ACK };
    }
    return {
      attemptKey,
      status,
      amount:
        event.type === 'payment_intent.succeeded'
          ? String(intent.amount_received)
          : null,
      rawCode: event.type,
      providerRef: intent.id,
      providerEventId: event.id,
      ack: SUCCESS_ACK,
    };
  }

  /** Checks the signature over the raw bytes before anything is read. */
  private verify(input: CallbackInput): Stripe.Event {
    const header = input.headers['stripe-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (typeof signature !== 'string' || signature === '') {
      throw new InvalidCallbackError('Missing Stripe-Signature header', ERROR_ACK);
    }
    try {
      return this.stripe.webhooks.constructEvent(
        Buffer.from(input.rawBody),
        signature,
        this.webhookSecret,
        WEBHOOK_TOLERANCE_SECONDS,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new InvalidCallbackError(`Invalid Stripe webhook: ${reason}`, ERROR_ACK);
    }
  }

  private async searchByAttemptKey(attemptKey: string): Promise<Stripe.PaymentIntent> {
    const escaped = attemptKey.replaceAll("'", "\\'");
    const { data } = await this.stripe.paymentIntents.search({
      query: `metadata['attemptKey']:'${escaped}'`,
    });
    const newest = [...data].sort((a, b) => b.created - a.created)[0];
    if (!newest) {
      throw new GatewayNotFoundError(`No PaymentIntent for attempt ${attemptKey}`);
    }
    return newest;
  }

  /**
   * Runs one Stripe call and translates SDK errors into Core's categories.
   * `initiate` and `cancel` may have reached Stripe, so a lost answer is an
   * unknown outcome; a `query` is safe to retry.
   */
  private async call<T>(operation: Operation, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw translateError(error, operation);
    }
  }
}

function toIntegerAmount(amount: string): number {
  const match = /^(\d+)(?:\.0+)?$/.exec(amount);
  const value = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(value)) {
    throw new GatewayRejectedError(`VND amount must be a whole number: ${amount}`);
  }
  return value;
}

function withoutClientSecret(intent: Stripe.PaymentIntent): unknown {
  const { client_secret: _clientSecret, ...rest } = intent;
  return rest;
}

/** The PaymentIntent from a "cannot cancel, already canceled" Stripe error. */
function alreadyCancelled(error: unknown): Stripe.PaymentIntent | undefined {
  if (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === 'payment_intent_unexpected_state' &&
    error.payment_intent?.status === 'canceled'
  ) {
    return error.payment_intent;
  }
  return undefined;
}

function translateError(error: unknown, operation: Operation): Error {
  const { errors } = Stripe;
  if (error instanceof GatewayNotFoundError) return error;
  if (
    error instanceof errors.StripeInvalidRequestError &&
    error.code === 'resource_missing' &&
    operation !== 'initiate'
  ) {
    return new GatewayNotFoundError(error.message);
  }
  if (error instanceof errors.StripeRateLimitError) {
    return new GatewayUnavailableError(error.message);
  }
  if (
    error instanceof errors.StripeConnectionError ||
    error instanceof errors.StripeAPIError
  ) {
    return operation !== 'query'
      ? new OutcomeUnknownError(error.message)
      : new GatewayUnavailableError(error.message);
  }
  if (error instanceof errors.StripeError) {
    return new GatewayRejectedError(error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}
