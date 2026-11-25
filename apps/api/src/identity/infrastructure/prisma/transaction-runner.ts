import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { createRepositories, type Repositories } from './repositories.js';

/**
 * The only component of the identity module that opens database transactions.
 * `src/payment-core/architecture.spec.ts` fails the build if `$transaction`
 * appears anywhere else in the module.
 */
export abstract class TransactionRunner {
  /** Runs `work` in one transaction; rolls back every write if it throws. */
  abstract run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;

  /** Repositories outside any transaction, for reads and single writes. */
  abstract readonly repositories: Repositories;
}

@Injectable()
export class PrismaTransactionRunner extends TransactionRunner {
  readonly repositories: Repositories;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {
    super();
    this.repositories = createRepositories({ db: prisma });
  }

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work(createRepositories({ db: tx })),
    );
  }
}
