import { Inject, Injectable } from '@nestjs/common';
import { InvalidCredentialsError } from '../../domain/errors.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { toSessionUser, type SessionUser } from '../session.js';

/** The signed-in User with their Organization, for the Console to show. */
@Injectable()
export class GetSessionUser {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
  ) {}

  async execute(userId: string): Promise<SessionUser> {
    const { users, organizations } = this.runner.repositories;
    const user = await users.findById(userId);
    if (!user) throw new InvalidCredentialsError();
    const organization = user.organizationId
      ? await organizations.findById(user.organizationId)
      : null;
    return toSessionUser(user, organization?.name ?? null);
  }
}
