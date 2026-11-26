import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import type { GatewayMode } from '../../../port/payment-gateway.port.js';
import { GatewayManager } from '../../gateway-manager.js';
import {
  GatewaysReadRepository,
  type CallbackStatus,
} from '../../../domain/repositories/console-read/gateways-read.repository.js';

/** Public origin of the API (`PUBLIC_BASE_URL`, no trailing slash). */
export const PUBLIC_BASE_URL = Symbol('PUBLIC_BASE_URL');

const DAY_MS = 24 * 3_600_000;

export interface GatewaySummary {
  readonly id: string;
  readonly registered: boolean;
  readonly configured: boolean;
  readonly mode: GatewayMode;
  readonly callbackUrl: string;
}

export interface GatewayDetail extends GatewaySummary {
  readonly callbackCounts: Record<CallbackStatus, number>;
  readonly lastCallbackAt: string | null;
  readonly recentErrors: { category: string; count: number }[];
}

/**
 * The operator Gateways views. Lists the gateways with a registered Gateway
 * Plugin plus any gateway that holds data here (so a gateway whose plugin is
 * not configured is shown as unregistered rather than hidden). The Gateway
 * Manager has no separate "configured" signal: the composition root registers a
 * plugin only when its configuration resolved, so `configured` equals
 * `registered`. No credential is ever read.
 */
@Injectable()
export class GatewaysOverview {
  constructor(
    @Inject(GatewayManager) private readonly manager: GatewayManager,
    @Inject(GatewaysReadRepository)
    private readonly repo: GatewaysReadRepository,
    @Inject(PUBLIC_BASE_URL) private readonly baseUrl: string,
  ) {}

  async list(scope: ReadScope): Promise<GatewaySummary[]> {
    const ids = await this.knownIds(scope);
    const connections = await this.repo.connectionIds(scope);
    return [...ids].sort().map((id) => this.summary(id, connections.get(id)));
  }

  /** Undefined when the id is neither registered nor holds data. */
  async detail(
    scope: ReadScope,
    id: string,
    now = new Date(),
  ): Promise<GatewayDetail | undefined> {
    if (!(await this.knownIds(scope)).has(id)) return undefined;
    const health = await this.repo.callbackHealth(
      scope,
      id,
      new Date(now.getTime() - DAY_MS),
    );
    const connections = await this.repo.connectionIds(scope);
    return {
      ...this.summary(id, connections.get(id)),
      callbackCounts: health.counts,
      lastCallbackAt: health.lastCallbackAt?.toISOString() ?? null,
      // Gateway errors are not persisted yet.
      recentErrors: [],
    };
  }

  private async knownIds(scope: ReadScope): Promise<Set<string>> {
    return new Set([
      ...this.manager.deploymentGatewayIds(),
      ...(await this.repo.gatewayIdsWithData(scope)),
    ]);
  }

  /** A gateway whose credentials come only from Gateway Connections has no default instance. */
  private modeOf(id: string): GatewayMode {
    try {
      return this.manager.resolve(id).mode ?? 'test';
    } catch {
      return 'test';
    }
  }

  /**
   * The Callback URL names the Gateway Connection. Where the view spans
   * Organizations (or none is connected) there is no single connection, so it
   * shows the URL without one.
   */
  private callbackUrl(
    id: string,
    connectionIds: readonly string[] = [],
  ): string {
    const base = `${this.baseUrl}/api/webhooks/${encodeURIComponent(id)}`;
    return connectionIds.length === 1
      ? `${base}/${encodeURIComponent(connectionIds[0]!)}`
      : base;
  }

  private summary(
    id: string,
    connectionIds?: readonly string[],
  ): GatewaySummary {
    const registered = this.manager.deploymentGatewayIds().includes(id);
    return {
      id,
      registered,
      configured: registered,
      mode: registered ? this.modeOf(id) : 'test',
      callbackUrl: this.callbackUrl(id, connectionIds),
    };
  }
}
