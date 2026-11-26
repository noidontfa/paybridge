import { Module } from '@nestjs/common';
import type Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import {
  isProduction,
  resolveStripeConfig,
  type Env,
} from '../config/env.schema.js';
import {
  registration,
  type GatewayRegistration,
} from '../payment-core/gateway-manager/gateway-plugin-factory.js';
import { GATEWAY_PLUGINS } from '../payment-core/gateway-manager/gateway-plugins.token.js';
import { fakeGatewayFactory } from './fake/fake-gateway.plugin.js';
import { stripeGatewayFactory } from './stripe/stripe-gateway.plugin.js';

/**
 * Optional replacement for the Stripe SDK's HTTP layer. Unset in production;
 * tests override it to replay recorded responses instead of calling Stripe.
 */
export const STRIPE_HTTP_CLIENT = Symbol('STRIPE_HTTP_CLIENT');

/**
 * Composition root for Gateway Plugins. Every plugin registers one factory
 * here, explicitly; there is no scanning. The Gateway Manager builds the
 * instances. This is the only place allowed to import both Core and plugin
 * code.
 *
 * Real plugins (VNPay, ZaloPay) are added to the factory below. The Stripe
 * plugin is registered in every environment whenever its configuration is
 * present, with credentials read from env. The fake plugin is registered
 * outside production only, so tests and local development have a gateway to
 * talk to.
 */
@Module({
  providers: [
    { provide: STRIPE_HTTP_CLIENT, useValue: undefined },
    {
      provide: GATEWAY_PLUGINS,
      inject: [ConfigService, STRIPE_HTTP_CLIENT],
      useFactory: (
        config: ConfigService<Env, true>,
        httpClient: Stripe.HttpClient | undefined,
      ): GatewayRegistration[] => {
        const registrations: GatewayRegistration[] = [];
        if (
          !isProduction({ NODE_ENV: config.get('NODE_ENV', { infer: true }) })
        ) {
          registrations.push(registration(fakeGatewayFactory, undefined));
        }
        // Gateway Connections supply their own credentials; the test hook
        // replaces the HTTP layer for those instances too.
        const stripeFactory: typeof stripeGatewayFactory = {
          ...stripeGatewayFactory,
          create: (options) =>
            stripeGatewayFactory.create({
              ...options,
              ...(httpClient ? { httpClient } : {}),
            }),
        };
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
          registrations.push(
            registration(stripeFactory, {
              secretKey: stripe.secretKey,
              webhookSecret: stripe.webhookSecret,
              publishableKey: stripe.publishableKey,
            }),
          );
        } else {
          // No env account: the factory still serves Gateway Connections.
          registrations.push(
            registration(stripeFactory, undefined as never),
          );
        }
        return registrations;
      },
    },
  ],
  exports: [GATEWAY_PLUGINS],
})
export class GatewaysModule {}
