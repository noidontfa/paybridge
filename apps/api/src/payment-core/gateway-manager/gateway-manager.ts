import type { PaymentGateway } from '../port/index.js';
import {
  pluginCacheKey,
  type GatewayPluginFactory,
  type GatewayRegistration,
  type PluginInstanceKey,
} from './gateway-plugin-factory.js';

/** Boot-time error: two plugins declare the same gateway identifier. */
export class DuplicateGatewayError extends Error {
  override readonly name = 'DuplicateGatewayError';
}

/** Boot-time error: a registration is empty, or a required gateway has no plugin. */
export class MissingGatewayError extends Error {
  override readonly name = 'MissingGatewayError';
}

/** Runtime error: an attempt names a gateway identifier no plugin is registered for. */
export class UnknownGatewayError extends Error {
  override readonly name = 'UnknownGatewayError';

  constructor(
    readonly gatewayId: string,
    registered: readonly string[],
  ) {
    super(
      `No Gateway Plugin registered for gateway "${gatewayId}" (registered: ${
        registered.length > 0 ? registered.join(', ') : 'none'
      })`,
    );
  }
}

export interface GatewayManagerOptions {
  /** Gateway identifiers the deployment must serve; boot fails if one has no plugin. */
  readonly requiredGatewayIds?: readonly string[];
}

/**
 * Finds the Gateway Plugin for a PaymentTransaction from its gateway
 * identifier. Plugins are registered as factories explicitly in the
 * composition root; the manager builds each instance on first use and caches
 * it by gateway, Gateway Connection id and credentials version.
 */
export class GatewayManager {
  private readonly registrations = new Map<string, GatewayRegistration>();
  private readonly instances = new Map<string, PaymentGateway>();

  constructor(
    registrations: readonly GatewayRegistration[],
    options: GatewayManagerOptions = {},
  ) {
    registrations.forEach((entry, index) => {
      const gatewayId = entry?.factory?.gatewayId;
      if (typeof gatewayId !== 'string' || !gatewayId) {
        throw new MissingGatewayError(
          `Gateway Plugin registration #${index} is empty or has no gateway identifier`,
        );
      }
      if (this.registrations.has(gatewayId)) {
        throw new DuplicateGatewayError(
          `Duplicate Gateway Plugin registration for gateway "${gatewayId}"`,
        );
      }
      this.registrations.set(gatewayId, entry);
    });

    for (const gatewayId of options.requiredGatewayIds ?? []) {
      if (!this.registrations.has(gatewayId)) {
        throw new MissingGatewayError(
          `No Gateway Plugin registered for required gateway "${gatewayId}"`,
        );
      }
    }
  }

  resolve(gatewayId: string, key?: PluginInstanceKey): PaymentGateway {
    const entry = this.registrations.get(gatewayId);
    if (!entry) throw new UnknownGatewayError(gatewayId, this.gatewayIds());
    const cacheKey = pluginCacheKey(gatewayId, key);
    let instance = this.instances.get(cacheKey);
    if (!instance) {
      instance = (entry.factory as GatewayPluginFactory<unknown>).create(
        entry.credentials,
      );
      this.instances.set(cacheKey, instance);
    }
    return instance;
  }

  gatewayIds(): string[] {
    return [...this.registrations.keys()];
  }
}
