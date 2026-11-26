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
    if (entry.factory.credentialsSchema && entry.credentials === undefined) {
      // A gateway that needs credentials has no default instance unless the
      // deployment configured one (the legacy env account).
      throw new UnknownGatewayError(gatewayId, this.gatewayIds());
    }
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

  /**
   * The instance for one Gateway Connection: built from its decrypted
   * credentials, cached by connection id and credentials version. A
   * connection without credentials uses the registered default instance.
   */
  resolveForConnection(
    gatewayId: string,
    connection: {
      readonly id: string;
      readonly credentialsVersion: number;
      readonly credentials: unknown;
    },
  ): PaymentGateway {
    if (connection.credentials === null || connection.credentials === undefined) {
      return this.resolve(gatewayId);
    }
    const entry = this.registrations.get(gatewayId);
    if (!entry) throw new UnknownGatewayError(gatewayId, this.gatewayIds());
    const cacheKey = pluginCacheKey(gatewayId, {
      connectionId: connection.id,
      credentialsVersion: connection.credentialsVersion,
    });
    let instance = this.instances.get(cacheKey);
    if (!instance) {
      instance = (entry.factory as GatewayPluginFactory<unknown>).create(
        connection.credentials,
      );
      this.instances.set(cacheKey, instance);
    }
    return instance;
  }

  /** The factory's credentials schema; undefined when the gateway takes none. */
  credentialsSchema(gatewayId: string): GatewayPluginFactory['credentialsSchema'] {
    const entry = this.registrations.get(gatewayId);
    if (!entry) throw new UnknownGatewayError(gatewayId, this.gatewayIds());
    return entry.factory.credentialsSchema;
  }

  /**
   * Gateways the deployment itself serves (fake, or the legacy env account),
   * as opposed to those only Gateway Connections can supply credentials for.
   */
  deploymentGatewayIds(): string[] {
    return [...this.registrations.entries()]
      .filter(
        ([, entry]) =>
          !entry.factory.credentialsSchema || entry.credentials !== undefined,
      )
      .map(([id]) => id);
  }

  isRegistered(gatewayId: string): boolean {
    return this.registrations.has(gatewayId);
  }

  gatewayIds(): string[] {
    return [...this.registrations.keys()];
  }
}
