import { Inject, Injectable, Logger } from '@nestjs/common';
import { organizationScope } from '../domain/value-objects/organization-scope.js';
import type { PaymentTransaction } from '../domain/entities/payment-transaction.js';
import { ConnectionPlugins } from './connection-plugins.js';
import { TransactionRunner } from '../domain/repositories/transaction-runner.js';

/** What a provider cancel needs to know about an attempt. */
export type CancellableAttempt = Pick<
  PaymentTransaction,
  'id' | 'organizationId' | 'gatewayId' | 'providerMetadata'
>;

/**
 * Asks the providers to cancel attempts that Core has already cancelled and
 * committed (gateway switch, merchant cancel, late promotion, expiry). Call
 * it after the commit, with no transaction open.
 *
 * Best-effort: it never throws. A provider failure is logged and does not
 * change local state. A plugin that does not declare `supportsCancel` is
 * not called; that is logged as a defensive error, because Core only calls
 * an optional operation behind its capability flag. The provider's response
 * is stored as a `cancel` raw gateway response.
 */
@Injectable()
export class BestEffortCancel {
  private readonly logger = new Logger(BestEffortCancel.name);

  constructor(
    @Inject(ConnectionPlugins) private readonly plugins: ConnectionPlugins,
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  async cancel(attempts: readonly CancellableAttempt[]): Promise<void> {
    await Promise.all(attempts.map((attempt) => this.cancelOne(attempt)));
  }

  private async cancelOne(attempt: CancellableAttempt): Promise<void> {
    try {
      const plugin = await this.plugins.forExisting(
        attempt.organizationId,
        attempt.gatewayId,
      );
      if (!plugin.capabilities.supportsCancel || !plugin.cancel) {
        this.logger.error(
          `Skipped provider cancel: gateway ${attempt.gatewayId} does not ` +
            `declare supportsCancel (attempt ${attempt.id})`,
        );
        return;
      }
      const result = await plugin.cancel({
        attemptKey: attempt.id,
        providerMetadata: attempt.providerMetadata ?? {},
      });
      await this.runner.repositories.gatewayRawResponses.record(
        organizationScope(attempt.organizationId),
        {
          attemptId: attempt.id,
          operation: 'cancel',
          payload: result.rawPayload,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Provider cancel failed for attempt ${attempt.id} on gateway ` +
          `${attempt.gatewayId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
