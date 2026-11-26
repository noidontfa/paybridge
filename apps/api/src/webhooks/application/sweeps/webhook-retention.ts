import { Inject, Injectable } from '@nestjs/common';
import { ALL_ORGANIZATIONS } from '../../../payment-core/port/organization-scope.js';
import { WebhooksTransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { WebhooksClock } from '../../domain/services/ports.js';

export const WEBHOOK_RETENTION_OPTIONS = Symbol('WEBHOOK_RETENTION_OPTIONS');

export interface WebhookRetentionOptions {
  /** Finished deliveries are deleted this long after they were created. */
  readonly deliveryRetentionMs: number;
}

export interface WebhookRetentionResult {
  readonly deliveries: number;
}

/**
 * Webhook retention (spec: Webhook Endpoint and delivery, Retention), the
 * webhooks module's copy of Core's retention cleanup. Deletes succeeded and
 * failed deliveries, with their attempts, once older than the configured
 * period; a delivery still retrying is never touched. Runs hourly from the
 * `wh-retention` job scheduler; a repeated or overlapping run is harmless.
 */
@Injectable()
export class WebhookRetention {
  constructor(
    @Inject(WebhooksTransactionRunner)
    private readonly runner: WebhooksTransactionRunner,
    @Inject(WebhooksClock) private readonly clock: WebhooksClock,
    @Inject(WEBHOOK_RETENTION_OPTIONS)
    private readonly options: WebhookRetentionOptions,
  ) {}

  async run(): Promise<WebhookRetentionResult> {
    const before = new Date(
      this.clock.now().getTime() - this.options.deliveryRetentionMs,
    );
    const deliveries = await this.runner.run((repos) =>
      repos.deliveries.deleteFinishedBefore(ALL_ORGANIZATIONS, before),
    );
    return { deliveries };
  }
}
