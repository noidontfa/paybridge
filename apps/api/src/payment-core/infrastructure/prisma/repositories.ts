import type { Repositories } from '../../domain/repositories/repositories.js';
import type { DbContext } from './db.js';
import { PrismaGatewayConnectionRepository } from './gateway-connection.repository.js';
import { PrismaGatewayRawResponseRepository } from './gateway-raw-response.repository.js';
import { PrismaIdempotencyKeyRepository } from './idempotency-key.repository.js';
import { PrismaOutboxRepository } from './outbox.repository.js';
import { PrismaPaymentRepository } from './payment.repository.js';
import { PrismaStatusTransitionRepository } from './status-transition.repository.js';
import { PrismaWebhookInboxRepository } from './webhook-inbox.repository.js';

/** Every Prisma repository, bound to one database handle. Add new ones here. */
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
