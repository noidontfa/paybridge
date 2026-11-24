import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProduction, type Env } from '../config/env.schema.js';
import { GATEWAY_PLUGINS } from '../payment-core/gateway-manager/gateway-plugins.token.js';
import type { PaymentGateway } from '../payment-core/port/index.js';
import { FakeGatewayPlugin } from './fake/fake-gateway.plugin.js';

/**
 * Composition root for Gateway Plugins. Every plugin is registered here,
 * explicitly; there is no scanning. This is the only place allowed to import
 * both Core and plugin code.
 *
 * Real plugins (VNPay, ZaloPay, Stripe) are added to the factory below. The
 * fake plugin is registered outside production only, so tests and local
 * development have a gateway to talk to.
 */
@Module({
  providers: [
    { provide: FakeGatewayPlugin, useFactory: () => new FakeGatewayPlugin() },
    {
      provide: GATEWAY_PLUGINS,
      inject: [ConfigService, FakeGatewayPlugin],
      useFactory: (
        config: ConfigService<Env, true>,
        fake: FakeGatewayPlugin,
      ): PaymentGateway[] =>
        isProduction({ NODE_ENV: config.get('NODE_ENV', { infer: true }) })
          ? []
          : [fake],
    },
  ],
  exports: [GATEWAY_PLUGINS, FakeGatewayPlugin],
})
export class GatewaysModule {}
