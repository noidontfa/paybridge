import type { Repositories } from './repositories.js';

/**
 * The only component of the checkout module that opens database
 * transactions. `src/payment-core/architecture.spec.ts` fails the build if any
 * other file in the module opens one.
 */
export abstract class TransactionRunner {
  /** Runs `work` in one transaction; rolls back every write if it throws. */
  abstract run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;

  /** Repositories outside any transaction, for reads and single writes. */
  abstract readonly repositories: Repositories;
}
