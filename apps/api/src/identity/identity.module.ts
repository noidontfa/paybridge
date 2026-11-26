import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../config/env.schema.js';
import { GetOrganization } from './application/use-cases/get-organization.js';
import { GetSessionUser } from './application/use-cases/get-session-user.js';
import { ChangePassword } from './application/use-cases/change-password.js';
import { CompletePasswordReset } from './application/use-cases/complete-password-reset.js';
import { RequestPasswordReset } from './application/use-cases/request-password-reset.js';
import { RefreshSession } from './application/use-cases/refresh-session.js';
import { SignIn } from './application/use-cases/sign-in.js';
import { SignOut } from './application/use-cases/sign-out.js';
import { AcceptInvitation } from './application/use-cases/accept-invitation.js';
import {
  InvitationMailer,
  ListPendingInvitations,
  ResendInvitation,
  RevokeInvitation,
  SendInvitation,
} from './application/use-cases/manage-invitations.js';
import { InvitationsController } from './http/invitations.controller.js';
import { ManageUsers } from './application/use-cases/manage-users.js';
import { UsersController } from './http/users.controller.js';
import { SuperAdminsController } from './http/super-admins.controller.js';
import {
  CreateOrganization,
  SetOrganizationSuspension,
} from './application/use-cases/manage-organizations.js';
import { ManageSuperAdmins } from './application/use-cases/manage-super-admins.js';
import { AccessGuard } from './http/access.guard.js';
import { AuthController, JwksController } from './http/auth.controller.js';
import { HttpPrincipalResolver } from './http/http-principal.resolver.js';
import { OrganizationsController } from './http/organizations.controller.js';
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
import { UserRepository } from './port/user.repository.js';

/**
 * Identity: Organizations, Users, sign-in and tokens, Invitations, Password
 * Resets and API Keys (`iam_` tables). Later tickets register the rest here.
 * Needs the global `PrismaModule`.
 */
@Module({
  controllers: [
    AuthController,
    JwksController,
    OrganizationsController,
    InvitationsController,
    UsersController,
    SuperAdminsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
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
    {
      provide: UserRepository,
      inject: [TransactionRunner],
      useFactory: (runner: TransactionRunner) => runner.repositories.users,
    },
    GetOrganization,
    SignIn,
    RefreshSession,
    SignOut,
    GetSessionUser,
    RequestPasswordReset,
    CompletePasswordReset,
    ChangePassword,
    InvitationMailer,
    SendInvitation,
    ResendInvitation,
    RevokeInvitation,
    ListPendingInvitations,
    AcceptInvitation,
    ManageUsers,
    CreateOrganization,
    SetOrganizationSuspension,
    ManageSuperAdmins,
  ],
  exports: [EmailSender, GetOrganization, PrincipalResolver],
})
export class IdentityModule {}
