import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidCredentialsError,
  OrganizationSuspendedError,
  UserDeactivatedError,
} from '../../domain/errors.js';
import { newIdentityId } from '../../domain/ids.js';
import { REFRESH_TOKEN_MAX_AGE_MS } from '../../domain/refresh-token.js';
import { normalizeEmail } from '../../domain/user.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AccessTokenService } from '../../port/access-token.service.js';
import { IdentityClock } from '../../port/clock.js';
import { PasswordHasher } from '../../port/password-hasher.js';
import { issueSession, type Session } from '../session.js';

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

/**
 * Email and password sign-in. An unknown email and a wrong password give the
 * same error (and the same work, so timing does not tell them apart). The
 * deactivated and suspended refusals come only after the password is right.
 */
@Injectable()
export class SignIn {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(input: SignInInput): Promise<Session> {
    const user = await this.runner.repositories.users.findByEmail(
      normalizeEmail(input.email),
    );
    const hash =
      user?.passwordHash ?? (await (this.dummyHash ??= this.hasher.hash('-')));
    const passwordMatches = await this.hasher.verify(input.password, hash);
    if (!user || !passwordMatches) throw new InvalidCredentialsError();
    if (!user.active) throw new UserDeactivatedError();

    const now = this.clock.now();
    return this.runner.run(async (repos) => {
      if (user.organizationId) {
        const organization = await repos.organizations.findById(
          user.organizationId,
        );
        if (organization?.status !== 'ACTIVE') {
          throw new OrganizationSuspendedError();
        }
      }
      return issueSession(repos, this.tokens, user, now, {
        familyId: newIdentityId(),
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_MAX_AGE_MS),
      });
    });
  }
}
