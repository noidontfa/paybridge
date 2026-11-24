import type { PaymentGateway } from '../port/index.js';

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
 * identifier. The map is built once, at boot, from the plugins registered
 * explicitly in the composition root.
 */
export class GatewayManager {
  private readonly plugins = new Map<string, PaymentGateway>();

  constructor(
    plugins: readonly PaymentGateway[],
    options: GatewayManagerOptions = {},
  ) {
    plugins.forEach((plugin, index) => {
      if (
        !plugin ||
        typeof plugin.gatewayId !== 'string' ||
        !plugin.gatewayId
      ) {
        throw new MissingGatewayError(
          `Gateway Plugin registration #${index} is empty or has no gateway identifier`,
        );
      }
      if (this.plugins.has(plugin.gatewayId)) {
        throw new DuplicateGatewayError(
          `Duplicate Gateway Plugin registration for gateway "${plugin.gatewayId}"`,
        );
      }
      this.plugins.set(plugin.gatewayId, plugin);
    });

    for (const gatewayId of options.requiredGatewayIds ?? []) {
      if (!this.plugins.has(gatewayId)) {
        throw new MissingGatewayError(
          `No Gateway Plugin registered for required gateway "${gatewayId}"`,
        );
      }
    }
  }

  resolve(gatewayId: string): PaymentGateway {
    const plugin = this.plugins.get(gatewayId);
    if (!plugin) throw new UnknownGatewayError(gatewayId, this.gatewayIds());
    return plugin;
  }

  gatewayIds(): string[] {
    return [...this.plugins.keys()];
  }
}
