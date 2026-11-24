import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GATEWAY_PLUGINS } from '../payment-core/gateway-manager/gateway-plugins.token.js';
import { GatewayManagerModule } from '../payment-core/gateway-manager/gateway-manager.module.js';
import { GatewayManager } from '../payment-core/gateway-manager/gateway-manager.js';
import { FakeGatewayPlugin } from './fake/fake-gateway.plugin.js';
import { GatewaysModule } from './gateways.module.js';

function configFor(NODE_ENV: string) {
  return ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    load: [() => ({ NODE_ENV })],
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
