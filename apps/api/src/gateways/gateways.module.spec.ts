import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import { GATEWAY_PLUGINS } from '../payment-core/gateway-manager/gateway-plugins.token.js';
import { GatewayManagerModule } from '../payment-core/gateway-manager/gateway-manager.module.js';
import { GatewayManager } from '../payment-core/gateway-manager/gateway-manager.js';
import { FakeGatewayPlugin } from './fake/fake-gateway.plugin.js';
import { GatewaysModule } from './gateways.module.js';
import { StripeGatewayPlugin } from './stripe/stripe-gateway.plugin.js';

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
};

function configFor(NODE_ENV: string, extra: Record<string, string> = {}) {
  return ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    load: [() => ({ NODE_ENV, ...extra })],
  });
}

describe('Gateway composition root', () => {
  it('boots a GatewayManager that resolves the fake plugin outside production', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configFor('test'),
        GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      ],
    }).compile();

    const manager = moduleRef.get(GatewayManager);
    expect(manager.resolve('fake')).toBe(moduleRef.get(FakeGatewayPlugin));
  });

  it('does not register the fake plugin in production', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configFor('production'),
        GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      ],
    }).compile();

    expect(moduleRef.get(GatewayManager).gatewayIds()).toEqual([]);
  });

  it('registers the Stripe plugin when Stripe is configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configFor('test', STRIPE_ENV),
        GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      ],
    }).compile();

    const manager = moduleRef.get(GatewayManager);
    expect(manager.gatewayIds()).toEqual(['fake', 'stripe']);
    expect(manager.resolve('stripe')).toBeInstanceOf(StripeGatewayPlugin);
  });

  it('wires the configured webhook secret into the Stripe plugin', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configFor('test', STRIPE_ENV),
        GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      ],
    }).compile();
    const plugin = moduleRef.get(GatewayManager).resolve('stripe');

    const sign = (secret: string) => {
      const body = JSON.stringify({
        id: 'evt_1QxModule',
        object: 'event',
        type: 'payment_intent.succeeded',
        livemode: false,
        data: {
          object: {
            id: 'pi_3QxModule',
            object: 'payment_intent',
            amount: 150000,
            amount_received: 150000,
            livemode: false,
            metadata: { attemptKey: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b' },
          },
        },
      });
      return {
        rawBody: new TextEncoder().encode(body),
        headers: {
          'stripe-signature': new Stripe(
            'sk_test_123',
          ).webhooks.generateTestHeaderString({ payload: body, secret }),
        },
        query: {},
      };
    };

    await expect(
      plugin.parseCallback(sign(STRIPE_ENV.STRIPE_WEBHOOK_SECRET)),
    ).resolves.toMatchObject({ status: 'SUCCEEDED', providerRef: 'pi_3QxModule' });
    await expect(plugin.parseCallback(sign('whsec_wrong'))).rejects.toThrow(
      /Invalid Stripe webhook/,
    );
  });

  it('does not register the Stripe plugin when Stripe is not configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configFor('test'),
        GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      ],
    }).compile();

    expect(moduleRef.get(GatewayManager).gatewayIds()).toEqual(['fake']);
  });

  it('registers exactly the Stripe plugin in production when configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configFor('production', STRIPE_ENV),
        GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      ],
    }).compile();

    expect(moduleRef.get(GatewayManager).gatewayIds()).toEqual(['stripe']);
  });

  it('fails at boot when two plugins share a gateway identifier', async () => {
    @Module({
      providers: [
        {
          provide: GATEWAY_PLUGINS,
          useValue: [new FakeGatewayPlugin(), new FakeGatewayPlugin()],
        },
      ],
      exports: [GATEWAY_PLUGINS],
    })
    class DuplicatePlugins {}

    await expect(
      Test.createTestingModule({
        imports: [
          GatewayManagerModule.forRoot({ imports: [DuplicatePlugins] }),
        ],
      }).compile(),
    ).rejects.toThrow(
      /Duplicate Gateway Plugin registration for gateway "fake"/,
    );
  });

  it('fails at boot when a required gateway is missing', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          configFor('test'),
          GatewayManagerModule.forRoot({
            imports: [GatewaysModule],
            requiredGatewayIds: ['vnpay'],
          }),
        ],
      }).compile(),
    ).rejects.toThrow(/required gateway "vnpay"/);
  });
});
