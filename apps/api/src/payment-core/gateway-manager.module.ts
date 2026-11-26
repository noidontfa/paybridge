import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import type { GatewayRegistration } from './port/gateway-plugin-factory.js';
import { GatewayManager } from './application/gateway-manager.js';
import { GATEWAY_PLUGINS } from './port/gateway-plugins.token.js';

export interface GatewayManagerModuleOptions {
  /** Module(s) from the composition root that export `GATEWAY_PLUGINS`. */
  imports: NonNullable<ModuleMetadata['imports']>;
  requiredGatewayIds?: readonly string[];
}

/**
 * Provides the `GatewayManager` globally. Core never names a plugin: the
 * composition root passes the module that registers them explicitly.
 */
@Module({})
export class GatewayManagerModule {
  static forRoot(options: GatewayManagerModuleOptions): DynamicModule {
    return {
      module: GatewayManagerModule,
      global: true,
      imports: options.imports,
      providers: [
        {
          provide: GatewayManager,
          inject: [GATEWAY_PLUGINS],
          useFactory: (registrations: GatewayRegistration[]) =>
            new GatewayManager(registrations, {
              requiredGatewayIds: options.requiredGatewayIds,
            }),
        },
      ],
      exports: [GatewayManager],
    };
  }
}
