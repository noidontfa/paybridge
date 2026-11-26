import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { PrismaModule } from './database/prisma.module.js';
import { GatewaysModule } from './gateways/gateways.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { AppLoggerModule } from './logger/app-logger.module.js';
import { GatewayManagerModule } from './payment-core/gateway-manager.module.js';
import { PaymentCoreModule } from './payment-core/payment-core.module.js';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    HealthModule,
    GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
    IdentityModule,
    PaymentCoreModule,
    CheckoutModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
