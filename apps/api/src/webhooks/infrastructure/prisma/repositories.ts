import type { Repositories } from '../../domain/repositories/repositories.js';
import type { DbContext } from './db.js';
import { PrismaManualAttemptRepository } from './manual-attempt.repository.js';
import { PrismaWebhookDeliveryRepository } from './webhook-delivery.repository.js';
import { PrismaWebhookEndpointRepository } from './webhook-endpoint.repository.js';

/** Every Prisma repository, bound to one database handle. Add new ones here. */
export function createRepositories(ctx: DbContext): Repositories {
  return {
    endpoints: new PrismaWebhookEndpointRepository(ctx),
    deliveries: new PrismaWebhookDeliveryRepository(ctx),
    manualAttempts: new PrismaManualAttemptRepository(ctx),
  };
}
