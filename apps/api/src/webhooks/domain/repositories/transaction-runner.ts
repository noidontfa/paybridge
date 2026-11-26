import type { Repositories } from './repositories.js';

/**
 * The only component of the webhooks module that opens database
 * transactions (`src/payment-core/architecture.spec.ts` checks it).
 */
export abstract class WebhooksTransactionRunner {
  /** Runs `work` in one transaction; rolls back every write if it throws. */
  abstract run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;

  /** Repositories outside any transaction, for reads and single writes. */
  abstract readonly repositories: Repositories;
}
