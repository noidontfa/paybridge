// Payment Events, as other modules consume them: the outbox queue the relay
// fills and the data of each job. Consumers dedupe by `outboxEventId`
// (delivery is at least once) and must not assume any order.
export { OUTBOX_EVENT_TYPES } from '../domain/records.js';
export type { OutboxEventType } from '../domain/records.js';
export type { OutboxJobData } from '../infrastructure/queue/outbox-relay.js';
import { QUEUES } from '../infrastructure/queue/queue.constants.js';

/** The BullMQ queue of Payment Events. Job name: the event type. */
export const OUTBOX_QUEUE = QUEUES.outbox;
