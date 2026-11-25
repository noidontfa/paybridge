import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../config/env.schema.js';
import { GetOrganization } from './application/use-cases/get-organization.js';
import { GetSessionUser } from './application/use-cases/get-session-user.js';
import { RefreshSession } from './application/use-cases/refresh-session.js';
import { SignIn } from './application/use-cases/sign-in.js';
import { SignOut } from './application/use-cases/sign-out.js';
import { AuthController, JwksController } from './http/auth.controller.js';
import { HttpPrincipalResolver } from './http/http-principal.resolver.js';
import { PrincipalGuard } from './http/principal.guard.js';
import { StubPrincipalResolver } from './http/stub-principal.resolver.js';
import { Argon2PasswordHasher } from './infrastructure/crypto/argon2-password-hasher.js';
import { Es256AccessTokenService } from './infrastructure/crypto/es256-access-token.service.js';
import { ConsoleLogEmailSender } from './infrastructure/email/console-log-email-sender.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from './infrastructure/prisma/transaction-runner.js';
import { AccessTokenService } from './port/access-token.service.js';
import { IdentityClock, SystemIdentityClock } from './port/clock.js';
import { EmailSender } from './port/email-sender.js';
import { OrganizationRepository } from './port/organization.repository.js';
import { PasswordHasher } from './port/password-hasher.js';
import { PrincipalResolver } from './port/principal-resolver.js';

/**
 * Identity: Organizations, Users, sign-in and tokens, Invitations, Password
 * Resets and API Keys (`iam_` tables). Later tickets register the rest here.
 * Needs the global `PrismaModule`.
 */
@Module({
  controllers: [AuthController, JwksController],
  providers: [
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: EmailSender, useClass: ConsoleLogEmailSender },
    StubPrincipalResolver,
    { provide: PrincipalResolver, useClass: HttpPrincipalResolver },
    { provide: IdentityClock, useClass: SystemIdentityClock },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    {
      provide: AccessTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Es256AccessTokenService(
          config.get('AUTH_JWT_PRIVATE_KEY', { infer: true }),
        ),
    },
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
    {
      provide: OrganizationRepository,
      inject: [TransactionRunner],
      useFactory: (runner: TransactionRunner) =>
        runner.repositories.organizations,
    },
    GetOrganization,
    SignIn,
    RefreshSession,
    SignOut,
    GetSessionUser,
  ],
  exports: [EmailSender, GetOrganization, PrincipalResolver],
})
export class IdentityModule {}
