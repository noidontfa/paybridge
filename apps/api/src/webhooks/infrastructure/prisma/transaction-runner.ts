import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Repositories } from '../../domain/repositories/repositories.js';
import { WebhooksTransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { createRepositories } from './repositories.js';

@Injectable()
export class PrismaWebhooksTransactionRunner extends WebhooksTransactionRunner {
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
