import {
  GatewayRejectedError,
  GatewayUnavailableError,
  InvalidCallbackError,
  type InitiateInput,
} from '../../payment-core/port/index.js';
import { FAKE_GATEWAY_ID, FakeGatewayPlugin } from './fake-gateway.plugin.js';

const attemptKey = '019a2b3c-4d5e-7f00-8a00-0000000000aa';

const initiateInput: InitiateInput = {
  attemptKey,
  amount: '150000',
  currency: 'VND',
  expiresAt: new Date('2026-11-24T10:30:00.000Z'),
  returnUrl: 'https://shop.example/return',
  description: 'Order 42',
};

describe('FakeGatewayPlugin', () => {
  let fake: FakeGatewayPlugin;

  beforeEach(() => {
    fake = new FakeGatewayPlugin();
  });

  it('declares a constant gateway identifier and capability flags', () => {
    expect(fake.gatewayId).toBe(FAKE_GATEWAY_ID);
    expect(fake.capabilities).toEqual({ supportsCancel: true });
    expect(fake.cancel).toBeTypeOf('function');

    const noCancel = new FakeGatewayPlugin({
      gatewayId: 'fake-b',
      supportsCancel: false,
    });
    expect(noCancel.gatewayId).toBe('fake-b');
    expect(noCancel.capabilities.supportsCancel).toBe(false);
    expect(noCancel.cancel).toBeUndefined();
  });

  it('initiates with a redirect by default and records the call', async () => {
    const result = await fake.initiate(initiateInput);

    expect(result.nextAction).toEqual({
      type: 'REDIRECT',
      url: `https://fake-gateway.test/pay/${attemptKey}`,
    });
    expect(result.providerMetadata).toEqual({ attemptKey });
    expect(result.rawPayload).toBeDefined();
    expect(fake.calls.initiate).toEqual([initiateInput]);
  });

  it('initiates with a QR code carrying the attempt key when told to', async () => {
    const qr = new FakeGatewayPlugin({ gatewayId: 'fake-qr', nextAction: 'QR_CODE' });

    const result = await qr.initiate(initiateInput);

    expect(result.nextAction).toEqual({
      type: 'QR_CODE',
      payload: `fake-qr://pay/${attemptKey}`,
    });
  });

  it('returns scripted results in order, then falls back to the default', async () => {
    fake.scriptInitiate(
      {
        providerRef: 'FAKE-1',
        nextAction: { type: 'QR_CODE', payload: 'qr-data' },
        providerMetadata: { token: 't' },
        rawPayload: { code: 0 },
      },
      new GatewayRejectedError('declined'),
    );

    await expect(fake.initiate(initiateInput)).resolves.toMatchObject({
      providerRef: 'FAKE-1',
      nextAction: { type: 'QR_CODE', payload: 'qr-data' },
    });
    await expect(fake.initiate(initiateInput)).rejects.toBeInstanceOf(
      GatewayRejectedError,
    );
    await expect(fake.initiate(initiateInput)).resolves.toMatchObject({
      nextAction: { type: 'REDIRECT' },
    });
  });

  it('accepts a function step, so a test can block or inspect the input', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.scriptQuery(async (input) => {
      await gate;
      return {
        status: 'SUCCEEDED',
        amount: '150000',
        rawPayload: { for: input.attemptKey },
      };
    });

    const pending = fake.query({ attemptKey, providerMetadata: {} });
    release();
    await expect(pending).resolves.toMatchObject({
      status: 'SUCCEEDED',
      rawPayload: { for: attemptKey },
    });
  });

  it('queries as PENDING with the initiated amount by default', async () => {
    await fake.initiate(initiateInput);

    await expect(
      fake.query({ attemptKey, providerMetadata: { attemptKey } }),
    ).resolves.toMatchObject({ status: 'PENDING', amount: '150000' });
  });

  it('cancels by default and can be scripted to fail', async () => {
    fake.scriptCancel(new GatewayUnavailableError('down'));

    await expect(
      fake.cancel!({ attemptKey, providerMetadata: {} }),
    ).rejects.toMatchObject({ retryable: true });
    await expect(
      fake.cancel!({ attemptKey, providerMetadata: {} }),
    ).resolves.toHaveProperty('rawPayload');
    expect(fake.calls.cancel).toHaveLength(2);
  });

  describe('callbacks', () => {
    it('parses a signed callback and acknowledges success', async () => {
      const callback = fake.signedCallback({
        attemptKey,
        status: 'SUCCEEDED',
        amount: '150000',
        providerRef: 'FAKE-9',
        eventId: 'evt-1',
      });

      await expect(fake.parseCallback(callback)).resolves.toEqual({
        attemptKey,
        status: 'SUCCEEDED',
        amount: '150000',
        providerRef: 'FAKE-9',
        providerEventId: 'evt-1',
        ack: { httpStatus: 200, body: { ok: true } },
      });
    });

    it('rejects a forged callback with the error acknowledgement', async () => {
      const callback = fake.signedCallback({
        attemptKey,
        status: 'SUCCEEDED',
        amount: '150000',
      });
      const forged = {
        ...callback,
        headers: { ...callback.headers, 'x-fake-signature': 'forged' },
      };

      const error = await fake.parseCallback(forged).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidCallbackError);
      expect((error as InvalidCallbackError).ack).toEqual({
        httpStatus: 400,
        body: { ok: false },
      });
    });

    it('can be scripted like any other operation', async () => {
      fake.scriptParseCallback(
        new InvalidCallbackError('scripted', { httpStatus: 401, body: 'no' }),
      );

      await expect(
        fake.parseCallback(
          fake.signedCallback({ attemptKey, status: 'FAILED', amount: null }),
        ),
      ).rejects.toMatchObject({ category: 'InvalidCallback' });
    });
  });

  it('reset clears scripts and recorded calls', async () => {
    fake.scriptInitiate(new GatewayRejectedError('x'));
    await fake.initiate(initiateInput).catch(() => undefined);
    fake.reset();

    expect(fake.calls.initiate).toEqual([]);
    await expect(fake.initiate(initiateInput)).resolves.toBeDefined();
  });
});
