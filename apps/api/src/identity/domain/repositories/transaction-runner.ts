import type { Repositories } from './repositories.js';

/**
 * The only component of the identity module that opens database transactions.
 * `src/payment-core/architecture.spec.ts` fails the build if any other file
 * in the module opens a database transaction.
 *
 * Nest injects it by this abstract class, so unit tests can provide a fake.
 */
export abstract class TransactionRunner {
  /** Runs `work` in one transaction; rolls back every write if it throws. */
  abstract run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;

  /** Repositories outside any transaction, for reads and single writes. */
  abstract readonly repositories: Repositories;
}
