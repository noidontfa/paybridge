import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  InvalidCallbackError,
  OutcomeUnknownError,
  type InitiateInput,
} from '../../payment-core/port/index.js';
import { FixtureHttpClient } from './fixture-http-client.js';
import { StripeGatewayPlugin } from './stripe-gateway.plugin.js';

const ATTEMPT_KEY = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const WEBHOOK_SECRET = 'whsec_test_fixture';
const PI_ID = 'pi_3QxTest1AbCdEfGh0aBcDeFg';

const initiateInput: InitiateInput = {
  attemptKey: ATTEMPT_KEY,
  amount: '150000',
  currency: 'VND',
  expiresAt: new Date('2026-11-24T12:00:00Z'),
  returnUrl: 'https://shop.example/return',
  description: 'Order 1001',
};

describe('StripeGatewayPlugin', () => {
  let http: FixtureHttpClient;
  let plugin: StripeGatewayPlugin;
  const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    logger.warn.mockClear();
    http = new FixtureHttpClient();
    plugin = new StripeGatewayPlugin({
      secretKey: 'sk_test_fixture',
      publishableKey: 'pk_test_fixture',
      webhookSecret: WEBHOOK_SECRET,
      httpClient: http,
      maxNetworkRetries: 0,
      logger,
    });
  });

  describe('identity', () => {
    it('declares the stripe id, cancel support and signature header', () => {
      expect(plugin.gatewayId).toBe('stripe');
      expect(plugin.capabilities.supportsCancel).toBe(true);
      expect(plugin.callbackHeaders).toEqual(['stripe-signature']);
      expect(typeof plugin.cancel).toBe('function');
      expect(plugin.mode).toBe('test');
      expect(
        new StripeGatewayPlugin({
          secretKey: 'sk_live_fixture',
          publishableKey: 'pk_live_fixture',
          webhookSecret: WEBHOOK_SECRET,
          httpClient: http,
        }).mode,
      ).toBe('live');
    });
  });

  describe('initiate', () => {
    it('creates a card-only, automatic-capture VND PaymentIntent idempotently', async () => {
      http.respond(200, 'payment-intent.requires-payment-method');

      await plugin.initiate(initiateInput);

      const [request] = http.requests;
      expect(request?.method).toBe('POST');
      expect(request?.path).toBe('/v1/payment_intents');
      expect(request?.body).toMatchObject({
        amount: '150000',
        currency: 'vnd',
        'allowed_payment_method_types[0]': 'card',
        capture_method: 'automatic',
        description: 'Order 1001',
        'metadata[attemptKey]': ATTEMPT_KEY,
      });
      expect(request?.headers['Idempotency-Key']).toBe(ATTEMPT_KEY);
    });

    it('returns the PaymentIntent id, a client SDK next action and metadata', async () => {
      http.respond(200, 'payment-intent.requires-payment-method');

      const result = await plugin.initiate(initiateInput);

      expect(result.providerRef).toBe(PI_ID);
      expect(result.nextAction).toEqual({
        type: 'CLIENT_SDK',
        token: `${PI_ID}_secret_TestSecretValue123`,
        clientParams: {
          publishableKey: 'pk_test_fixture',
          returnUrl: 'https://shop.example/return',
        },
      });
      expect(result.providerMetadata).toEqual({
        paymentIntentId: PI_ID,
        livemode: false,
      });
    });

    it('removes client_secret from the raw payload', async () => {
      http.respond(200, 'payment-intent.requires-payment-method');

      const result = await plugin.initiate(initiateInput);

      expect(result.rawPayload).toMatchObject({
        id: PI_ID,
        status: 'requires_payment_method',
      });
      expect(JSON.stringify(result.rawPayload)).not.toContain('client_secret');
      expect(JSON.stringify(result.rawPayload)).not.toContain(
        'TestSecretValue123',
      );
    });

    it('is OutcomeUnknown when Stripe returns no client secret', async () => {
      http.respond(200, 'payment-intent.no-client-secret');

      await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(
        OutcomeUnknownError,
      );
    });

    it.each(['1500.5', '100.25', 'abc', ''])(
      'rejects non-integer amount %j without calling Stripe',
      async (amount) => {
        await expect(
          plugin.initiate({ ...initiateInput, amount }),
        ).rejects.toBeInstanceOf(GatewayRejectedError);
        expect(http.requests).toHaveLength(0);
      },
    );
  });

  describe('query', () => {
    const query = (
      providerMetadata: Record<string, unknown> = { paymentIntentId: PI_ID },
    ) => plugin.query({ attemptKey: ATTEMPT_KEY, providerMetadata });

    it('retrieves the PaymentIntent by id', async () => {
      http.respond(200, 'payment-intent.succeeded');

      await query();

      expect(http.requests[0]).toMatchObject({
        method: 'GET',
        path: `/v1/payment_intents/${PI_ID}`,
      });
    });

    it.each([
      ['succeeded', 'SUCCEEDED', '150000'],
      ['canceled', 'FAILED', null],
      ['requires-payment-method', 'PENDING', null],
      ['requires-confirmation', 'PENDING', null],
      ['requires-action', 'PENDING', null],
      ['processing', 'PENDING', null],
      ['requires-capture', 'REQUIRES_REVIEW', null],
    ])('maps %s to %s', async (fixture, status, amount) => {
      http.respond(200, `payment-intent.${fixture}`);

      const result = await query();

      expect(result).toMatchObject({
        status,
        amount,
        providerRef: PI_ID,
        rawCode: fixture.replaceAll('-', '_'),
      });
      expect(JSON.stringify(result.rawPayload)).not.toContain('client_secret');
    });

    it('searches on the attempt key when no PaymentIntent id is known', async () => {
      http.respond(200, 'search.one-match');

      const result = await query({});

      expect(http.requests[0]?.method).toBe('GET');
      expect(http.requests[0]?.path).toContain('/v1/payment_intents/search');
      expect(decodeURIComponent(http.requests[0]?.path ?? '')).toContain(
        `metadata['attemptKey']:'${ATTEMPT_KEY}'`,
      );
      expect(result).toMatchObject({ status: 'PENDING', providerRef: PI_ID });
    });

    it('is NotFound when the search has no match', async () => {
      http.respond(200, 'search.no-match');

      await expect(query({})).rejects.toBeInstanceOf(GatewayNotFoundError);
    });

    it('uses the newest PaymentIntent if the search returns several', async () => {
      http.respond(200, 'search.two-matches');

      const result = await query({});

      expect(result.providerRef).toBe('pi_3QxTest2Newer0000000000');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(ATTEMPT_KEY),
      );
    });

    it('does not warn when the search returns one match', async () => {
      http.respond(200, 'search.one-match');

      await query({});

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('is NotFound on resource_missing', async () => {
      http.respond(404, 'error.resource-missing');

      await expect(query()).rejects.toBeInstanceOf(GatewayNotFoundError);
    });
  });

  describe('cancel', () => {
    const cancel = () =>
      plugin.cancel!({
        attemptKey: ATTEMPT_KEY,
        providerMetadata: { paymentIntentId: PI_ID },
      });

    it('cancels the PaymentIntent with a derived idempotency key', async () => {
      http.respond(200, 'payment-intent.canceled');

      const result = await cancel();

      expect(http.requests[0]).toMatchObject({
        method: 'POST',
        path: `/v1/payment_intents/${PI_ID}/cancel`,
      });
      expect(http.requests[0]?.headers['Idempotency-Key']).toBe(
        `${ATTEMPT_KEY}:cancel`,
      );
      expect(JSON.stringify(result.rawPayload)).not.toContain('client_secret');
    });

    it('treats an already-cancelled PaymentIntent as success', async () => {
      http.respond(400, 'error.unexpected-state-canceled');

      const result = await cancel();

      expect(result.rawPayload).toMatchObject({
        id: PI_ID,
        status: 'canceled',
      });
    });

    it('retrieves the PaymentIntent when the error body does not carry it', async () => {
      http.respond(400, 'error.unexpected-state-no-payment-intent');
      http.respond(200, 'payment-intent.canceled');

      const result = await cancel();

      expect(http.requests[1]).toMatchObject({
        method: 'GET',
        path: `/v1/payment_intents/${PI_ID}`,
      });
      expect(result.rawPayload).toMatchObject({
        id: PI_ID,
        status: 'canceled',
      });
    });

    it('rejects when the error body is bare and the PaymentIntent succeeded', async () => {
      http.respond(400, 'error.unexpected-state-no-payment-intent');
      http.respond(200, 'payment-intent.succeeded');

      await expect(cancel()).rejects.toBeInstanceOf(GatewayRejectedError);
    });

    it('finds the PaymentIntent by attempt key when no id is known, then cancels it', async () => {
      http.respond(200, 'search.one-match');
      http.respond(200, 'payment-intent.canceled');

      const result = await plugin.cancel!({
        attemptKey: ATTEMPT_KEY,
        providerMetadata: {},
      });

      expect(http.requests[0]?.path).toContain('/v1/payment_intents/search');
      expect(http.requests[1]).toMatchObject({
        method: 'POST',
        path: `/v1/payment_intents/${PI_ID}/cancel`,
      });
      expect(result.rawPayload).toMatchObject({ status: 'canceled' });
    });

    it('is NotFound when no id is known and the search has no match', async () => {
      http.respond(200, 'search.no-match');

      await expect(
        plugin.cancel!({ attemptKey: ATTEMPT_KEY, providerMetadata: {} }),
      ).rejects.toBeInstanceOf(GatewayNotFoundError);
    });

    it('rejects when the PaymentIntent already succeeded', async () => {
      http.respond(400, 'error.unexpected-state-succeeded');

      await expect(cancel()).rejects.toBeInstanceOf(GatewayRejectedError);
    });

    it('is NotFound on resource_missing', async () => {
      http.respond(404, 'error.resource-missing');

      await expect(cancel()).rejects.toBeInstanceOf(GatewayNotFoundError);
    });
  });

  describe('error mapping', () => {
    const connectionFailure = () => new Error('socket hang up');

    const fixtureErrors: [string, number, string][] = [
      ['amount below minimum', 400, 'error.amount-too-small'],
      ['authentication error', 401, 'error.authentication'],
      ['permission error', 403, 'error.permission'],
      ['idempotency error', 400, 'error.idempotency'],
    ];

    it.each(fixtureErrors)(
      '%s is GatewayRejected on initiate',
      async (_n, status, fixture) => {
        http.respond(status, fixture);
        await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(
          GatewayRejectedError,
        );
      },
    );

    it('rate limiting is retryable GatewayUnavailable on every operation', async () => {
      for (const run of [
        () => plugin.initiate(initiateInput),
        () =>
          plugin.query({
            attemptKey: ATTEMPT_KEY,
            providerMetadata: { paymentIntentId: PI_ID },
          }),
        () =>
          plugin.cancel!({
            attemptKey: ATTEMPT_KEY,
            providerMetadata: { paymentIntentId: PI_ID },
          }),
      ]) {
        http.respond(429, 'error.rate-limit');
        const error = await run().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GatewayUnavailableError);
        expect((error as GatewayUnavailableError).retryable).toBe(true);
      }
    });

    it('a 5xx on initiate or cancel is OutcomeUnknown', async () => {
      http.respond(500, 'error.api-500');
      await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(
        OutcomeUnknownError,
      );

      http.respond(500, 'error.api-500');
      await expect(
        plugin.cancel!({
          attemptKey: ATTEMPT_KEY,
          providerMetadata: { paymentIntentId: PI_ID },
        }),
      ).rejects.toBeInstanceOf(OutcomeUnknownError);
    });

    it('a connection error on initiate or cancel is OutcomeUnknown', async () => {
      http.failWith(connectionFailure());
      await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(
        OutcomeUnknownError,
      );

      http.failWith(connectionFailure());
      await expect(
        plugin.cancel!({
          attemptKey: ATTEMPT_KEY,
          providerMetadata: { paymentIntentId: PI_ID },
        }),
      ).rejects.toBeInstanceOf(OutcomeUnknownError);
    });

    it('a 5xx or connection error on query is retryable GatewayUnavailable', async () => {
      const input = {
        attemptKey: ATTEMPT_KEY,
        providerMetadata: { paymentIntentId: PI_ID },
      };

      http.respond(500, 'error.api-500');
      const fromServer = await plugin.query(input).catch((e: unknown) => e);
      expect(fromServer).toBeInstanceOf(GatewayUnavailableError);

      http.failWith(connectionFailure());
      const fromNetwork = await plugin.query(input).catch((e: unknown) => e);
      expect(fromNetwork).toBeInstanceOf(GatewayUnavailableError);
      expect((fromNetwork as GatewayUnavailableError).retryable).toBe(true);
    });

    it('a search 5xx without a PaymentIntent id is GatewayUnavailable', async () => {
      http.respond(500, 'error.api-500');
      await expect(
        plugin.query({ attemptKey: ATTEMPT_KEY, providerMetadata: {} }),
      ).rejects.toBeInstanceOf(GatewayUnavailableError);
    });
  });
  describe('parseCallback', () => {
    const stripe = new Stripe('sk_test_fixture');
    const EVENT_ID = 'evt_1QxTestEvent';

    function event(
      type: string,
      object: Record<string, unknown> = {},
      livemode = false,
    ): Record<string, unknown> {
      return {
        id: EVENT_ID,
        object: 'event',
        type,
        livemode,
        data: {
          object: {
            id: PI_ID,
            object: 'payment_intent',
            amount: 150000,
            amount_received: 0,
            livemode,
            metadata: { attemptKey: ATTEMPT_KEY },
            ...object,
          },
        },
      };
    }

    function signed(
      payload: Record<string, unknown> | string,
      options: { secret?: string; timestamp?: number } = {},
    ) {
      const body =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
      const header = stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret: options.secret ?? WEBHOOK_SECRET,
        ...(options.timestamp === undefined
          ? {}
          : { timestamp: options.timestamp }),
      });
      return {
        rawBody: new TextEncoder().encode(body),
        headers: { 'stripe-signature': header },
        query: {},
      };
    }

    const ACK = { httpStatus: 200, body: '' };

    it('maps payment_intent.succeeded to SUCCEEDED with amount_received', async () => {
      const result = await plugin.parseCallback(
        signed(event('payment_intent.succeeded', { amount_received: 149000 })),
      );

      expect(result).toEqual({
        attemptKey: ATTEMPT_KEY,
        status: 'SUCCEEDED',
        amount: '149000',
        rawCode: 'payment_intent.succeeded',
        providerRef: PI_ID,
        providerEventId: EVENT_ID,
        ack: ACK,
      });
    });

    it.each([
      ['payment_intent.payment_failed', 'PENDING'],
      ['payment_intent.processing', 'PENDING'],
      ['payment_intent.canceled', 'FAILED'],
    ])('maps %s to %s', async (type, status) => {
      const result = await plugin.parseCallback(signed(event(type)));

      expect(result).toMatchObject({
        attemptKey: ATTEMPT_KEY,
        status,
        amount: null,
        providerRef: PI_ID,
        providerEventId: EVENT_ID,
        ack: ACK,
      });
    });

    it.each([
      [
        'a missing header',
        () => ({ ...signed(event('payment_intent.succeeded')), headers: {} }),
      ],
      [
        'a bad signature',
        () =>
          signed(event('payment_intent.succeeded'), { secret: 'whsec_other' }),
      ],
      [
        'a stale timestamp',
        () =>
          signed(event('payment_intent.succeeded'), {
            timestamp: Math.floor(Date.now() / 1000) - 301,
          }),
      ],
      ['an unparseable body', () => signed('not json')],
    ])('rejects %s with a 400 acknowledgement', async (_name, build) => {
      const error = await plugin
        .parseCallback(build())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidCallbackError);
      expect((error as InvalidCallbackError).ack).toEqual({
        httpStatus: 400,
        body: '',
      });
    });

    it('verifies over the exact raw bytes', async () => {
      const callback = signed(event('payment_intent.succeeded'));
      const tampered = {
        ...callback,
        rawBody: new TextEncoder().encode(
          new TextDecoder().decode(callback.rawBody).replace('150000', '1'),
        ),
      };

      await expect(plugin.parseCallback(tampered)).rejects.toBeInstanceOf(
        InvalidCallbackError,
      );
    });

    it.each([
      ['another event type', event('charge.succeeded')],
      [
        'a missing attemptKey',
        event('payment_intent.succeeded', { metadata: {} }),
      ],
      [
        'a non-UUID attemptKey',
        event('payment_intent.succeeded', {
          metadata: { attemptKey: 'order-7' },
        }),
      ],
      [
        'a live-mode event on test keys',
        event('payment_intent.succeeded', {}, true),
      ],
    ])('ignores %s', async (_name, payload) => {
      await expect(plugin.parseCallback(signed(payload))).resolves.toEqual({
        ignored: true,
        ack: ACK,
      });
    });

    it('ignores a test-mode event on live keys', async () => {
      const live = new StripeGatewayPlugin({
        secretKey: 'sk_live_fixture',
        publishableKey: 'pk_live_fixture',
        webhookSecret: WEBHOOK_SECRET,
        httpClient: http,
      });

      await expect(
        live.parseCallback(signed(event('payment_intent.succeeded'))),
      ).resolves.toEqual({ ignored: true, ack: ACK });
    });
  });
});
