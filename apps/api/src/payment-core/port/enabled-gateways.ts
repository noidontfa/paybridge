// Part of Payment Core's public surface for other modules: which
// PaymentGateways an Organization can take Payments with right now, so the
// checkout can offer only those. Provided and exported by PaymentCoreModule.
import type { OrganizationScope } from '../domain/value-objects/organization-scope.js';

export abstract class EnabledGateways {
  /**
   * The gateway ids the Organization holds an enabled Gateway Connection for,
   * and that this deployment has a Gateway Plugin for; sorted.
   */
  abstract ids(scope: OrganizationScope): Promise<string[]>;
}
