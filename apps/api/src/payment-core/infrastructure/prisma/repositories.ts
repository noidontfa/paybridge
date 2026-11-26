import type { DbContext } from './db.js';
import { PrismaGatewayConnectionRepository } from './gateway-connection.repository.js';
import { PrismaGatewayRawResponseRepository } from './gateway-raw-response.repository.js';
import { PrismaIdempotencyKeyRepository } from './idempotency-key.repository.js';
import { PrismaOutboxRepository } from './outbox.repository.js';
import { PrismaPaymentRepository } from './payment.repository.js';
import { PrismaStatusTransitionRepository } from './status-transition.repository.js';
import { PrismaWebhookInboxRepository } from './webhook-inbox.repository.js';

/** The public surface of a class: what a fake in a unit test must provide. */
type PublicOf<T> = { [K in keyof T]: T[K] };

export type PaymentRepository = PublicOf<PrismaPaymentRepository>;
export type OutboxRepository = PublicOf<PrismaOutboxRepository>;
export type WebhookInboxRepository = PublicOf<PrismaWebhookInboxRepository>;
export type IdempotencyKeyRepository = PublicOf<PrismaIdempotencyKeyRepository>;
export type GatewayConnectionRepository =
  PublicOf<PrismaGatewayConnectionRepository>;
export type GatewayRawResponseRepository =
  PublicOf<PrismaGatewayRawResponseRepository>;
export type StatusTransitionRepository =
  PublicOf<PrismaStatusTransitionRepository>;

/**
 * Every repository, bound to one database handle. The transaction runner
 * hands a transaction-bound set to its callback. There is no Refund
 * repository in Phase 1. Add new repositories here.
 */
export interface Repositories {
  readonly payments: PaymentRepository;
  readonly outbox: OutboxRepository;
  readonly webhookInbox: WebhookInboxRepository;
  readonly idempotencyKeys: IdempotencyKeyRepository;
  readonly gatewayConnections: GatewayConnectionRepository;
  readonly gatewayRawResponses: GatewayRawResponseRepository;
  readonly statusTransitions: StatusTransitionRepository;
}

export function createRepositories(ctx: DbContext): Repositories {
  return {
    payments: new PrismaPaymentRepository(ctx),
    outbox: new PrismaOutboxRepository(ctx),
    webhookInbox: new PrismaWebhookInboxRepository(ctx),
    idempotencyKeys: new PrismaIdempotencyKeyRepository(ctx),
    gatewayConnections: new PrismaGatewayConnectionRepository(ctx),
    gatewayRawResponses: new PrismaGatewayRawResponseRepository(ctx),
    statusTransitions: new PrismaStatusTransitionRepository(ctx),
  };
}
