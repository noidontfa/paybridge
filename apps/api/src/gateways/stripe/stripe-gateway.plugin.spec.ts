import { beforeEach, describe, expect, it } from 'vitest';
import {
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  OutcomeUnknownError,
  type InitiateInput,
} from '../../payment-core/port/index.js';
import { FixtureHttpClient } from './fixture-http-client.js';
import { StripeGatewayPlugin } from './stripe-gateway.plugin.js';

const ATTEMPT_KEY = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
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

  beforeEach(() => {
    http = new FixtureHttpClient();
    plugin = new StripeGatewayPlugin({
      secretKey: 'sk_test_fixture',
      publishableKey: 'pk_test_fixture',
      httpClient: http,
      maxNetworkRetries: 0,
    });
  });

  describe('identity', () => {
    it('declares the stripe id, cancel support and signature header', () => {
      expect(plugin.gatewayId).toBe('stripe');
      expect(plugin.capabilities.supportsCancel).toBe(true);
      expect(plugin.callbackHeaders).toEqual(['stripe-signature']);
      expect(typeof plugin.cancel).toBe('function');
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

      expect(result.rawPayload).toMatchObject({ id: PI_ID, status: 'requires_payment_method' });
      expect(JSON.stringify(result.rawPayload)).not.toContain('client_secret');
      expect(JSON.stringify(result.rawPayload)).not.toContain('TestSecretValue123');
    });

    it.each(['1500.5', '100.25', 'abc', ''])(
      'rejects non-integer amount %j without calling Stripe',
      async (amount) => {
        await expect(plugin.initiate({ ...initiateInput, amount })).rejects.toBeInstanceOf(
          GatewayRejectedError,
        );
        expect(http.requests).toHaveLength(0);
      },
    );
  });

  describe('query', () => {
    const query = (providerMetadata: Record<string, unknown> = { paymentIntentId: PI_ID }) =>
      plugin.query({ attemptKey: ATTEMPT_KEY, providerMetadata });

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
      expect(http.requests[0]?.headers['Idempotency-Key']).toBe(`${ATTEMPT_KEY}:cancel`);
      expect(JSON.stringify(result.rawPayload)).not.toContain('client_secret');
    });

    it('treats an already-cancelled PaymentIntent as success', async () => {
      http.respond(400, 'error.unexpected-state-canceled');

      const result = await cancel();

      expect(result.rawPayload).toMatchObject({ id: PI_ID, status: 'canceled' });
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

    it.each(fixtureErrors)('%s is GatewayRejected on initiate', async (_n, status, fixture) => {
      http.respond(status, fixture);
      await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(GatewayRejectedError);
    });

    it('rate limiting is retryable GatewayUnavailable on every operation', async () => {
      for (const run of [
        () => plugin.initiate(initiateInput),
        () => plugin.query({ attemptKey: ATTEMPT_KEY, providerMetadata: { paymentIntentId: PI_ID } }),
        () =>
          plugin.cancel!({ attemptKey: ATTEMPT_KEY, providerMetadata: { paymentIntentId: PI_ID } }),
      ]) {
        http.respond(429, 'error.rate-limit');
        const error = await run().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GatewayUnavailableError);
        expect((error as GatewayUnavailableError).retryable).toBe(true);
      }
    });

    it('a 5xx on initiate or cancel is OutcomeUnknown', async () => {
      http.respond(500, 'error.api-500');
      await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(OutcomeUnknownError);

      http.respond(500, 'error.api-500');
      await expect(
        plugin.cancel!({ attemptKey: ATTEMPT_KEY, providerMetadata: { paymentIntentId: PI_ID } }),
      ).rejects.toBeInstanceOf(OutcomeUnknownError);
    });

    it('a connection error on initiate or cancel is OutcomeUnknown', async () => {
      http.failWith(connectionFailure());
      await expect(plugin.initiate(initiateInput)).rejects.toBeInstanceOf(OutcomeUnknownError);

      http.failWith(connectionFailure());
      await expect(
        plugin.cancel!({ attemptKey: ATTEMPT_KEY, providerMetadata: { paymentIntentId: PI_ID } }),
      ).rejects.toBeInstanceOf(OutcomeUnknownError);
    });

    it('a 5xx or connection error on query is retryable GatewayUnavailable', async () => {
      const input = { attemptKey: ATTEMPT_KEY, providerMetadata: { paymentIntentId: PI_ID } };

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
});
