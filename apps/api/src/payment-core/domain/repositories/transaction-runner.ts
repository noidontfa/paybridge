import type { Repositories } from './repositories.js';

export interface TransactionOptions {
  /** Maximum time the transaction may stay open. Default 10 seconds. */
  readonly timeoutMs?: number;
}

/**
 * The only component that opens database transactions (spec: Transaction
 * runner). `src/payment-core/architecture.spec.ts` fails the build if any
 * other file opens a database transaction.
 *
 * Rule: never call a gateway inside `run`. Read under lock, return, call the
 * gateway, then `run` again and re-validate before writing.
 *
 * Nest injects it by this abstract class, so unit tests can provide a fake.
 */
export abstract class TransactionRunner {
  /**
   * Runs `work` in one transaction with repositories bound to it. Commits when
   * `work` resolves; rolls back every write when it throws.
   */
  abstract run<T>(
    work: (repos: Repositories) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;

  /**
   * Repositories outside any transaction, for reads and single-statement
   * writes that need no lock. `findForUpdate` throws here.
   */
  abstract readonly repositories: Repositories;
}
