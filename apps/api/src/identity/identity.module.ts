import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GetOrganization } from './application/use-cases/get-organization.js';
import { PrincipalGuard } from './http/principal.guard.js';
import { StubPrincipalResolver } from './http/stub-principal.resolver.js';
import { ConsoleLogEmailSender } from './infrastructure/email/console-log-email-sender.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { EmailSender } from './port/email-sender.js';
import { OrganizationRepository } from './port/organization.repository.js';
import { PrincipalResolver } from './port/principal-resolver.js';

/**
 * Identity: Organizations, Users, Invitations, Password Resets, sign-in and
 * API Keys (`iam_` tables). Later tickets register the rest here. Needs the
 * global `PrismaModule`.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: EmailSender, useClass: ConsoleLogEmailSender },
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
  exports: [EmailSender, GetOrganization, PrincipalResolver],
})
export class IdentityModule {}
