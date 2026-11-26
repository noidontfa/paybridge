import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthenticateApiKey,
  CreateApiKey,
  ListApiKeys,
  RevokeApiKey,
} from './application/use-cases/api-keys.js';
import { ApiKeysController } from './infrastructure/http/api-keys.controller.js';
import {
  AuthenticatePublishableKey,
  CreatePublishableKey,
  ListPublishableKeys,
  RevokePublishableKey,
  SetPublishableKeyOrigins,
} from './application/use-cases/publishable-keys.js';
import { PublishableKeysController } from './infrastructure/http/publishable-keys.controller.js';
import { CheckoutCorsMiddleware } from './infrastructure/http/checkout-cors.middleware.js';
import { PublishableKeyRules } from './domain/services/publishable-key-rules.js';
import { isProduction, type Env } from '../config/env.schema.js';
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
import { InvitationsController } from './infrastructure/http/invitations.controller.js';
import { ManageUsers } from './application/use-cases/manage-users.js';
import { UsersController } from './infrastructure/http/users.controller.js';
import { SuperAdminsController } from './infrastructure/http/super-admins.controller.js';
import {
  CreateOrganization,
  SetOrganizationSuspension,
} from './application/use-cases/manage-organizations.js';
import { ManageSuperAdmins } from './application/use-cases/manage-super-admins.js';
import { AccessGuard } from './infrastructure/http/access.guard.js';
import { AuthController, JwksController } from './infrastructure/http/auth.controller.js';
import { HttpPrincipalResolver } from './infrastructure/http/http-principal.resolver.js';
import { OrganizationsController } from './infrastructure/http/organizations.controller.js';
import { PrincipalGuard } from './infrastructure/http/principal.guard.js';
import { Argon2PasswordHasher } from './infrastructure/crypto/argon2-password-hasher.js';
import { Es256AccessTokenService } from './infrastructure/crypto/es256-access-token.service.js';
import { ConsoleLogEmailSender } from './infrastructure/email/console-log-email-sender.js';
import { PrismaTransactionRunner } from './infrastructure/prisma/transaction-runner.js';
import { TransactionRunner } from './domain/repositories/transaction-runner.js';
import { AccessTokenService } from './domain/services/access-token.service.js';
import { IdentityClock, SystemIdentityClock } from './domain/services/clock.js';
import { EmailSender } from './domain/services/email-sender.js';
import { OrganizationRepository } from './domain/repositories/organization.repository.js';
import { PasswordHasher } from './domain/services/password-hasher.js';
import { PrincipalResolver } from './domain/services/principal-resolver.js';
import { UserRepository } from './domain/repositories/user.repository.js';

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
    ApiKeysController,
    PublishableKeysController,
    UsersController,
    SuperAdminsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: EmailSender, useClass: ConsoleLogEmailSender },
    { provide: PrincipalResolver, useClass: HttpPrincipalResolver },
    { provide: IdentityClock, useClass: SystemIdentityClock },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    {
      provide: AccessTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Es256AccessTokenService(
          config.get('AUTH_JWT_PRIVATE_KEY', { infer: true }),
          (config.get('AUTH_JWT_RETIRED_PUBLIC_KEYS', { infer: true }) ?? '')
            .split(',')
            .map((pem) => pem.trim())
            .filter(Boolean),
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
    CreateApiKey,
    ListApiKeys,
    RevokeApiKey,
    AuthenticateApiKey,
    {
      provide: PublishableKeyRules,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PublishableKeyRules(
          !isProduction({ NODE_ENV: config.get('NODE_ENV', { infer: true }) }),
        ),
    },
    CreatePublishableKey,
    ListPublishableKeys,
    SetPublishableKeyOrigins,
    RevokePublishableKey,
    AuthenticatePublishableKey,
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
export class IdentityModule implements NestModule {
  /** CORS for the checkout endpoints; the middleware ignores every other path. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CheckoutCorsMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
