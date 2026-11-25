import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * The database handle an identity repository is bound to: the root client, or
 * the transaction client the runner opened. Internal to
 * `infrastructure/prisma`; never part of a repository's public signature.
 */
export interface DbContext {
  readonly db: Prisma.TransactionClient;
}
