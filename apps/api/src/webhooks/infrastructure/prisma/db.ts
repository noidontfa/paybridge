import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * The database handle a webhooks repository is bound to: the root client, or
 * the transaction client the runner opened. Internal to `infrastructure/prisma`.
 */
export interface DbContext {
  readonly db: Prisma.TransactionClient;
}
