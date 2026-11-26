import type { PaymentGateway } from '../port/index.js';

/**
 * Builds a Gateway Plugin instance from one set of credentials. Each plugin
 * registers one factory; the Gateway Manager decides when to call it.
 */
export interface GatewayPluginFactory<C = never> {
  readonly gatewayId: string;
  /**
   * Validates the credentials a Gateway Connection stores for this gateway
   * and narrows them to `C`. Absent for a gateway that takes no credentials
   * (`fake`): its Gateway Connection holds none.
   */
  readonly credentialsSchema?: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: C }
      | { success: false; error: { issues: readonly { message: string; path: readonly PropertyKey[] }[] } };
  };
  create(credentials: C): PaymentGateway;
}

/**
 * A factory together with the credentials to build it with. Today the
 * credentials come from environment variables; a Gateway Connection will
 * supply them later.
 */
export interface GatewayRegistration {
  readonly factory: GatewayPluginFactory<never>;
  readonly credentials: unknown;
}

/** Pairs a factory with the credentials to call it with. */
export function registration<C>(
  factory: GatewayPluginFactory<C>,
  credentials: C,
): GatewayRegistration {
  return { factory: factory as GatewayPluginFactory<never>, credentials };
}

/** Registers an already-built plugin (tests, plugins without credentials). */
export function fixedPlugin(plugin: PaymentGateway): GatewayRegistration {
  return registration(
    { gatewayId: plugin.gatewayId, create: () => plugin },
    undefined,
  );
}

/** Identifies one built instance in the Gateway Manager's cache. */
export interface PluginInstanceKey {
  readonly connectionId?: string;
  readonly credentialsVersion?: number;
}

export function pluginCacheKey(
  gatewayId: string,
  key: PluginInstanceKey = {},
): string {
  return `${gatewayId}|${key.connectionId ?? ''}|${key.credentialsVersion ?? ''}`;
}
