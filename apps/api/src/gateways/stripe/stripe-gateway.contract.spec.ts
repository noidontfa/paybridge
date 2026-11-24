import Stripe from 'stripe';
import {
  describeGatewayContract,
  type ContractOutcome,
  type GatewayContractRegistration,
} from '../../../test/contract/payment-gateway.contract.js';
import type {
  CallbackInput,
  NormalizedStatus,
} from '../../payment-core/port/index.js';
import { FixtureHttpClient, loadFixture } from './fixture-http-client.js';
import { StripeGatewayPlugin } from './stripe-gateway.plugin.js';

const WEBHOOK_SECRET = 'whsec_contract_fixture';

/** Replies used when the suite makes a call the registration did not script. */
const DEFAULT_REPLIES: readonly [
  method: string,
  path: RegExp,
  fixture: string,
][] = [
  ['POST', /^\/v1\/payment_intents$/, 'payment-intent.requires-payment-method'],
  ['POST', /^\/v1\/payment_intents\/[^/]+\/cancel$/, 'payment-intent.canceled'],
];

/** Replays recorded responses; unscripted initiate and cancel calls succeed. */
class ContractHttpClient extends FixtureHttpClient {
  private queued = 0;

  override respond(status: number, fixture: string): this {
    this.queued += 1;
    return super.respond(status, fixture);
  }

  override failWith(error: Error): this {
    this.queued += 1;
    return super.failWith(error);
  }

  override makeRequest(
    host: string,
    port: string,
    path: string,
    method: string,
    headers: Record<string, unknown>,
    requestData: string,
  ): Promise<Stripe.HttpClientResponse> {
    if (this.queued > 0) {
      this.queued -= 1;
    } else {
      const fallback = DEFAULT_REPLIES.find(
        ([m, p]) => m === method && p.test(path),
      );
      if (fallback) {
        // Queue it directly so the bookkeeping above stays untouched.
        FixtureHttpClient.prototype.respond.call(this, 200, fallback[2]);
      }
    }
    return super.makeRequest(host, port, path, method, headers, requestData);
  }
}

/** The plugin plus the replay layer it talks to. */
class ReplayStripeGateway extends StripeGatewayPlugin {
  readonly http: ContractHttpClient;

  constructor() {
    const http = new ContractHttpClient();
    super({
      secretKey: 'sk_test_contract',
      publishableKey: 'pk_test_contract',
      webhookSecret: WEBHOOK_SECRET,
      httpClient: http,
      maxNetworkRetries: 0,
    });
    this.http = http;
  }
}

const signer = new Stripe('sk_test_contract');

/** A webhook carrying the named PaymentIntent fixture, signed like Stripe does. */
function webhook(
  type: string,
  fixture: string,
  attemptKey: string | undefined,
  options: { secret?: string; timestamp?: number; signed?: boolean } = {},
): CallbackInput {
  // Webhook payloads never carry the client secret.
  const { client_secret: _clientSecret, ...intent } = loadFixture(
    `payment-intent.${fixture}`,
  ) as Record<string, unknown>;
  const body = JSON.stringify({
    id: 'evt_1QxContractEvent',
    object: 'event',
    type,
    livemode: false,
    data: {
      object: {
        ...intent,
        metadata: attemptKey === undefined ? {} : { attemptKey },
      },
    },
  });
  const header = signer.webhooks.generateTestHeaderString({
    payload: body,
    secret: options.secret ?? WEBHOOK_SECRET,
    ...(options.timestamp === undefined
      ? {}
      : { timestamp: options.timestamp }),
  });
  return {
    rawBody: new TextEncoder().encode(body),
    headers: options.signed === false ? {} : { 'stripe-signature': header },
    query: {},
  };
}

/**
 * `query` replays the PaymentIntent fixture; the callback is the webhook
 * Stripe sends for that situation (optionally carrying a different fixture).
 */
const outcome = (
  situation: string,
  expected: NormalizedStatus,
  fixture: string,
  eventType: string | undefined,
  eventFixture = fixture,
): ContractOutcome<ReplayStripeGateway> => ({
  situation,
  expected,
  arrangeQuery: (plugin) => {
    plugin.http.respond(200, `payment-intent.${fixture}`);
  },
  ...(eventType && {
    callback: (
      _plugin: ReplayStripeGateway,
      { attemptKey }: { attemptKey: string },
    ) => webhook(eventType, eventFixture, attemptKey),
  }),
});

const registration: GatewayContractRegistration<ReplayStripeGateway> = {
  name: 'stripe plugin (replayed responses)',
  create: () => new ReplayStripeGateway(),
  outcomes: [
    outcome(
      'the customer has not paid yet',
      'PENDING',
      'requires-payment-method',
      'payment_intent.processing',
      'processing',
    ),
    outcome(
      'the card is declined',
      'PENDING',
      'declined',
      'payment_intent.payment_failed',
    ),
    outcome(
      'the payment succeeded',
      'SUCCEEDED',
      'succeeded',
      'payment_intent.succeeded',
    ),
    outcome(
      'the PaymentIntent was canceled',
      'FAILED',
      'canceled',
      'payment_intent.canceled',
    ),
    outcome(
      'the payment awaits capture',
      'REQUIRES_REVIEW',
      'requires-capture',
      undefined,
    ),
  ],
  errors: [
    {
      situation: 'Stripe rejects the amount',
      operation: 'initiate',
      category: 'GatewayRejected',
      arrange: (plugin) => {
        plugin.http.respond(400, 'error.amount-too-small');
      },
    },
    {
      situation: 'Stripe rate-limits the request',
      operation: 'initiate',
      category: 'GatewayUnavailable',
      arrange: (plugin) => {
        plugin.http.respond(429, 'error.rate-limit');
      },
    },
    {
      situation: 'Stripe answers 500 after the request was sent',
      operation: 'initiate',
      category: 'OutcomeUnknown',
      arrange: (plugin) => {
        plugin.http.respond(500, 'error.api-500');
      },
    },
    {
      situation: 'the connection drops after the request was sent',
      operation: 'initiate',
      category: 'OutcomeUnknown',
      arrange: (plugin) => {
        plugin.http.failWith(new Error('socket hang up'));
      },
    },
    {
      situation: 'Stripe has no such PaymentIntent',
      operation: 'query',
      category: 'NotFound',
      arrange: (plugin) => {
        plugin.http.respond(404, 'error.resource-missing');
      },
    },
  ],
  ignoredCallbacks: [
    {
      situation: 'an event type the plugin does not handle',
      build: (_plugin, { attemptKey }) =>
        webhook('charge.succeeded', 'succeeded', attemptKey),
    },
    {
      situation: 'a PaymentIntent that now awaits capture',
      build: (_plugin, { attemptKey }) =>
        webhook(
          'payment_intent.amount_capturable_updated',
          'requires-capture',
          attemptKey,
        ),
    },
    {
      situation: 'a PaymentIntent with no attempt key',
      build: () => webhook('payment_intent.succeeded', 'succeeded', undefined),
    },
  ],
  invalidCallbacks: [
    {
      problem: 'signed with another secret',
      build: (_plugin, { attemptKey }) =>
        webhook('payment_intent.succeeded', 'succeeded', attemptKey, {
          secret: 'whsec_other',
        }),
    },
    {
      problem: 'no Stripe-Signature header',
      build: (_plugin, { attemptKey }) =>
        webhook('payment_intent.succeeded', 'succeeded', attemptKey, {
          signed: false,
        }),
    },
    {
      problem: 'a stale timestamp',
      build: (_plugin, { attemptKey }) =>
        webhook('payment_intent.succeeded', 'succeeded', attemptKey, {
          timestamp: Math.floor(Date.now() / 1000) - 3600,
        }),
    },
  ],
};

describeGatewayContract(registration);
