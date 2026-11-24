import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { GatewayManager } from '../gateway-manager/gateway-manager.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';
import { QUEUES, jobIds } from '../infrastructure/queue/queue.constants.js';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verified webhook intake: the plugin verifies the callback, Core stores it in
 * the webhook inbox and returns the acknowledgement at once. Processing runs
 * later from the webhook queue.
 *
 * Throws `UnknownGatewayError` for an unregistered gateway; any other plugin
 * error propagates and nothing is stored.
 */
@Injectable()
export class WebhookIntake {
  private readonly logger = new Logger(WebhookIntake.name);

  constructor(
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @InjectQueue(QUEUES.webhookInbox) private readonly queue: Queue,
  ) {}

  async receive(callback: IncomingCallback): Promise<CallbackAck> {
    const plugin = this.gateways.resolve(callback.gatewayId);

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

    const providerEventId = parsed.providerEventId || null;
    const { entry, duplicate } =
      await this.runner.repositories.webhookInbox.record({
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

  /**
   * Not awaited: the acknowledgement must not wait for Redis. If the add is
   * lost, the inbox sweep re-dispatches the `RECEIVED` row (ADR 0002).
   */
  private dispatch(inboxId: string): void {
    const data: ProcessWebhookJobData = { inboxId };
    void this.queue
      .add(PROCESS_WEBHOOK_JOB, data, {
        jobId: jobIds.webhookInbox(inboxId),
        ...PROCESS_WEBHOOK_JOB_OPTIONS,
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
