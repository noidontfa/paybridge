import { Inject, Injectable } from '@nestjs/common';
import { TransactionRunner } from '../domain/repositories/transaction-runner.js';
import type { OrganizationScope } from '../domain/value-objects/organization-scope.js';
import { EnabledGateways } from '../port/enabled-gateways.js';
import { GatewayManager } from './gateway-manager.js';

/** Enabled Gateway Connections whose gateway has a registered plugin. */
@Injectable()
export class ListEnabledGateways extends EnabledGateways {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
  ) {
    super();
  }

  async ids(scope: OrganizationScope): Promise<string[]> {
    const connections =
      await this.runner.repositories.gatewayConnections.list(scope);
    return connections
      .filter((c) => c.enabled && this.gateways.isRegistered(c.gatewayId))
      .map((c) => c.gatewayId)
      .sort();
  }
}
