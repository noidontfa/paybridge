import { Inject, Injectable } from '@nestjs/common';
import type { GatewayMode } from '../../../port/payment-gateway.port.js';
import { GatewayManager } from '../../../gateway-manager/gateway-manager.js';
import {
  GatewaysReadRepository,
  type CallbackStatus,
} from '../../../infrastructure/prisma/console-read/gateways-read.repository.js';

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

  async list(): Promise<GatewaySummary[]> {
    const ids = await this.knownIds();
    return [...ids].sort().map((id) => this.summary(id));
  }

  /** Undefined when the id is neither registered nor holds data. */
  async detail(
    id: string,
    now = new Date(),
  ): Promise<GatewayDetail | undefined> {
    if (!(await this.knownIds()).has(id)) return undefined;
    const health = await this.repo.callbackHealth(
      id,
      new Date(now.getTime() - DAY_MS),
    );
    return {
      ...this.summary(id),
      callbackCounts: health.counts,
      lastCallbackAt: health.lastCallbackAt?.toISOString() ?? null,
      // Gateway errors are not persisted yet.
      recentErrors: [],
    };
  }

  private async knownIds(): Promise<Set<string>> {
    return new Set([
      ...this.manager.gatewayIds(),
      ...(await this.repo.gatewayIdsWithData()),
    ]);
  }

  private summary(id: string): GatewaySummary {
    const registered = this.manager.gatewayIds().includes(id);
    return {
      id,
      registered,
      configured: registered,
      mode: registered ? (this.manager.resolve(id).mode ?? 'test') : 'test',
      callbackUrl: `${this.baseUrl}/api/webhooks/${encodeURIComponent(id)}`,
    };
  }
}
