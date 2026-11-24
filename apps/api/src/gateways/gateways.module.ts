import { Module } from '@nestjs/common';
import type Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { isProduction, resolveStripeConfig, type Env } from '../config/env.schema.js';
import { GATEWAY_PLUGINS } from '../payment-core/gateway-manager/gateway-plugins.token.js';
import type { PaymentGateway } from '../payment-core/port/index.js';
import { FakeGatewayPlugin } from './fake/fake-gateway.plugin.js';
import { StripeGatewayPlugin } from './stripe/stripe-gateway.plugin.js';

/**
 * Optional replacement for the Stripe SDK's HTTP layer. Unset in production;
 * tests override it to replay recorded responses instead of calling Stripe.
 */
export const STRIPE_HTTP_CLIENT = Symbol('STRIPE_HTTP_CLIENT');

/**
 * Composition root for Gateway Plugins. Every plugin is registered here,
 * explicitly; there is no scanning. This is the only place allowed to import
 * both Core and plugin code.
 *
 * Real plugins (VNPay, ZaloPay) are added to the factory below. The Stripe
 * plugin is registered in every environment whenever its configuration is
 * present. The fake plugin is registered outside production only, so tests and
 * local development have a gateway to talk to.
 */
@Module({
  providers: [
    { provide: FakeGatewayPlugin, useFactory: () => new FakeGatewayPlugin() },
    { provide: STRIPE_HTTP_CLIENT, useValue: undefined },
    {
      provide: GATEWAY_PLUGINS,
      inject: [ConfigService, FakeGatewayPlugin, STRIPE_HTTP_CLIENT],
      useFactory: (
        config: ConfigService<Env, true>,
        fake: FakeGatewayPlugin,
        httpClient: Stripe.HttpClient | undefined,
      ): PaymentGateway[] => {
        const plugins: PaymentGateway[] = [];
        if (!isProduction({ NODE_ENV: config.get('NODE_ENV', { infer: true }) })) {
          plugins.push(fake);
        }
        const stripe = resolveStripeConfig({
          STRIPE_SECRET_KEY: config.get('STRIPE_SECRET_KEY', { infer: true }),
          STRIPE_WEBHOOK_SECRET: config.get('STRIPE_WEBHOOK_SECRET', {
            infer: true,
          }),
          STRIPE_PUBLISHABLE_KEY: config.get('STRIPE_PUBLISHABLE_KEY', {
            infer: true,
          }),
        });
        if (stripe) {
          plugins.push(
            new StripeGatewayPlugin({
              secretKey: stripe.secretKey,
              publishableKey: stripe.publishableKey,
              ...(httpClient ? { httpClient } : {}),
            }),
          );
        }
        return plugins;
      },
    },
  ],
  exports: [GATEWAY_PLUGINS, FakeGatewayPlugin],
})
export class GatewaysModule {}
