import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Repositories } from '../../domain/repositories.js';
import {
  TransactionRunner,
  type TransactionOptions,
} from '../../domain/transaction-runner.js';
import { createRepositories } from './repositories.js';

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaTransactionRunner extends TransactionRunner {
  readonly repositories: Repositories;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {
    super();
    this.repositories = createRepositories({
      db: prisma,
      inTransaction: false,
    });
  }

  run<T>(
    work: (repos: Repositories) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return this.prisma.$transaction(
      (tx) => work(createRepositories({ db: tx, inTransaction: true })),
      { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
  }
}
