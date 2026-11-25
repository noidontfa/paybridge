import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GetOrganization } from './application/use-cases/get-organization.js';
import { PrincipalGuard } from './http/principal.guard.js';
import { StubPrincipalResolver } from './http/stub-principal.resolver.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { OrganizationRepository } from './port/organization.repository.js';
import { PrincipalResolver } from './port/principal-resolver.js';

/**
 * Identity: Organizations (this ticket), later Users, sign-in, Invitations and
 * API Keys. Owns the `iam_` tables. Needs the global `PrismaModule`.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: PrincipalResolver, useClass: StubPrincipalResolver },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    {
      provide: OrganizationRepository,
      inject: [TransactionRunner],
      useFactory: (runner: TransactionRunner) =>
        runner.repositories.organizations,
    },
    GetOrganization,
  ],
  exports: [GetOrganization, PrincipalResolver],
})
export class IdentityModule {}
