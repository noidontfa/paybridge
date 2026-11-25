import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import {
  GatewaysOverview,
  PUBLIC_BASE_URL,
} from '../application/use-cases/console/gateways.js';
import { GatewaysController } from '../http/console/gateways.controller.js';
import { GatewaysReadRepository } from '../infrastructure/prisma/console-read/gateways-read.repository.js';

/**
 * `GET /internal/gateways` and `/internal/gateways/:id`. Needs the global
 * `PrismaModule` and `GatewayManagerModule`.
 */
@Module({
  controllers: [GatewaysController],
  providers: [
    GatewaysOverview,
    GatewaysReadRepository,
    {
      provide: PUBLIC_BASE_URL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('PUBLIC_BASE_URL', { infer: true }),
    },
  ],
})
export class GatewaysModule {}
