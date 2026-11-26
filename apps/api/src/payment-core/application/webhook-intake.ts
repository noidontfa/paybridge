import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ALL_ORGANIZATIONS } from '../domain/organization-scope.js';
import { organizationScope } from '../domain/organization-scope.js';
import { ConnectionPlugins } from './connection-plugins.js';
import { JobDispatcher } from '../domain/job-dispatcher.js';
import { TransactionRunner } from '../domain/transaction-runner.js';
import {
  InvalidCallbackError,
  type CallbackAck,
  type CallbackInput,
  type HeaderValues,
} from '../port/index.js';

/** BullMQ job name for processing one stored callback (ticket 19 consumes it). */
export const PROCESS_WEBHOOK_JOB = 'process-webhook';

/**
 * The inbox row, not BullMQ, holds the processing state (ADR 0002): the job is
 * removed when it ends, so the inbox sweep can dispatch the row again under
 * the same job id.
 */
export const PROCESS_WEBHOOK_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export interface ProcessWebhookJobData {
  readonly inboxId: string;
}

export interface IncomingCallback extends CallbackInput {
  readonly gatewayId: string;
}

/**
 * Whose Gateway Connection verifies the Callback: the one the URL names, or
 * (legacy route) the Organization's own for that gateway.
 */
export type CallbackTarget =
  { readonly connectionId: string } | { readonly organizationId: string };

/** The URL names no Gateway Connection for that gateway. */
export class UnknownGatewayConnectionError extends Error {
  override readonly name = 'UnknownGatewayConnectionError';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verified webhook intake: the plugin verifies the callback, Core stores it in
 * the webhook inbox and returns the acknowledgement at once. Processing runs
 * later from the webhook queue.
 *
 * The Gateway Connection is resolved first and verifies with its own
 * credentials; the Callback is stored with the connection's Organization, and
 * a disabled connection still counts. Throws `UnknownGatewayConnectionError`
 * for an unknown connection or one of another gateway, and
 * `UnknownGatewayError` for an unregistered gateway; any other plugin error
 * propagates and nothing is stored.
 */
@Injectable()
export class WebhookIntake {
  private readonly logger = new Logger(WebhookIntake.name);

  constructor(
    @Inject(ConnectionPlugins) private readonly plugins: ConnectionPlugins,
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
  ) {}

  async receive(
    target: CallbackTarget,
    callback: IncomingCallback,
  ): Promise<CallbackAck> {
    const { organizationId, plugin } = await this.resolve(target, callback);
    const scope = organizationScope(organizationId);

    let parsed;
    try {
      parsed = await plugin.parseCallback({
        rawBody: callback.rawBody,
        headers: callback.headers,
        query: callback.query,
      });
    } catch (error) {
      if (error instanceof InvalidCallbackError) {
        // Only the reason: the body may carry customer or payment data.
        this.logger.warn(
          `Rejected ${callback.gatewayId} callback: ${error.message}`,
        );
        return error.ack;
      }
      throw error;
    }

    if (parsed.ignored) {
      this.logger.debug(`Ignored ${callback.gatewayId} callback`);
      return parsed.ack;
    }

    const providerEventId = parsed.providerEventId || null;
    const { entry, duplicate } =
      await this.runner.repositories.webhookInbox.record(scope, {
        gatewayId: callback.gatewayId,
        dedupeKey:
          providerEventId ??
          createHash('sha256').update(callback.rawBody).digest('hex'),
        providerEventId,
        attemptKey: UUID.test(parsed.attemptKey) ? parsed.attemptKey : null,
        rawBody: callback.rawBody,
        headers: pick(callback.headers, plugin.callbackHeaders ?? []),
        query: callback.query,
      });

    if (!duplicate) this.dispatch(entry.id);
    return parsed.ack;
  }

  private async resolve(target: CallbackTarget, callback: IncomingCallback) {
    if (!('connectionId' in target)) {
      return {
        organizationId: target.organizationId,
        plugin: await this.plugins.forLegacyCallback(
          target.organizationId,
          callback.gatewayId,
        ),
      };
    }
    const connection = UUID.test(target.connectionId)
      ? await this.runner.repositories.gatewayConnections.findById(
          ALL_ORGANIZATIONS,
          target.connectionId,
        )
      : null;
    if (!connection || connection.gatewayId !== callback.gatewayId) {
      throw new UnknownGatewayConnectionError(
        `No Gateway Connection ${target.connectionId} for gateway "${callback.gatewayId}"`,
      );
    }
    return {
      organizationId: connection.organizationId,
      plugin: this.plugins.forConnection(connection),
    };
  }

  /**
   * Not awaited: the acknowledgement must not wait for Redis. If the add is
   * lost, the inbox sweep re-dispatches the `RECEIVED` row (ADR 0002).
   */
  private dispatch(inboxId: string): void {
    const data: ProcessWebhookJobData = { inboxId };
    void this.dispatcher
      .enqueue('webhookInbox', {
        name: PROCESS_WEBHOOK_JOB,
        jobId: inboxId,
        data,
        options: PROCESS_WEBHOOK_JOB_OPTIONS,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Could not dispatch webhook inbox row ${inboxId}: ${String(error)}`,
        );
      });
  }
}

function pick(
  headers: HeaderValues,
  allowed: readonly string[],
): Record<string, string | readonly string[]> {
  const kept: Record<string, string | readonly string[]> = {};
  for (const name of allowed) {
    const value = headers[name.toLowerCase()];
    if (value !== undefined) kept[name.toLowerCase()] = value;
  }
  return kept;
}
