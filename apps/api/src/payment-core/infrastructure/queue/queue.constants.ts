// The one place that names Core's BullMQ queues and defines job ids.
//
// BullMQ is dispatch only (ADR 0002): every job can be rebuilt from PostgreSQL
// rows, and its id is the id of that row, so re-adding the same job (relay
// replay, sweep re-run, another instance) is a no-op while the job exists.

export const QUEUES = {
  /** Outbox rows published by the relay. Job id: the outbox row id. */
  outbox: 'core-outbox',
  /** Verified callbacks to process. Job id: the webhook inbox row id. */
  webhookInbox: 'core-webhook-inbox',
  /** Payments past their deadline, enqueued by the sweep. Job id: the payment id. */
  paymentExpiry: 'core-payment-expiry',
  /** Runs of the expiry sweep, produced by its job scheduler. */
  expirySweep: 'core-expiry-sweep',
  /** Runs of the retention cleanup, produced by its job scheduler. */
  retention: 'core-retention',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A job id must be the UUID of its source row. That also keeps it valid for
 * BullMQ, which rejects ids containing `:` and plain integers.
 */
function rowJobId(kind: string, id: string): string {
  if (!UUID.test(id)) {
    throw new Error(`${kind} job id must be a UUID (got "${id}")`);
  }
  return id.toLowerCase();
}

export const jobIds = {
  /** An outbox event job: the outbox row id. */
  outboxEvent: (outboxRowId: string): string => rowJobId('outbox', outboxRowId),
  /** A per-Payment job (e.g. expiry): the payment id, one job per queue. */
  payment: (paymentId: string): string => rowJobId('payment', paymentId),
  /** A webhook processing job: the webhook inbox row id. */
  webhookInbox: (inboxId: string): string => rowJobId('webhook inbox', inboxId),
} as const;
