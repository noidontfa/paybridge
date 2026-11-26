import { Inject, Injectable } from '@nestjs/common';
import {
  EmailTakenError,
  InvalidInvitationTokenError,
} from '../../domain/errors.js';
import { newIdentityId } from '../../domain/ids.js';
import { isPending } from '../../domain/invitation.js';
import { assertStrongPassword } from '../../domain/user.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { IdentityClock } from '../../port/clock.js';
import { PasswordHasher } from '../../port/password-hasher.js';
import { hashInvitationToken } from './manage-invitations.js';

/**
 * Turns an Invitation link into an active User with the invited Role and
 * Organization, once. A too-short password is refused before the link is
 * spent.
 */
@Injectable()
export class AcceptInvitation {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(input: {
    token: string;
    name: string;
    password: string;
  }): Promise<void> {
    assertStrongPassword(input.password);
    const passwordHash = await this.hasher.hash(input.password);
    const now = this.clock.now();
    await this.runner.run(async (repos) => {
      const invitation = await repos.invitations.findByHash(
        hashInvitationToken(input.token),
      );
      if (!invitation || !isPending(invitation, now)) {
        throw new InvalidInvitationTokenError();
      }
      if (await repos.users.findByEmail(invitation.email)) {
        throw new EmailTakenError(invitation.email);
      }
      if (!(await repos.invitations.markAccepted(invitation.id, now))) {
        throw new InvalidInvitationTokenError();
      }
      await repos.users.create({
        id: newIdentityId(),
        email: invitation.email,
        name: input.name,
        passwordHash,
        role: invitation.role,
        organizationId: invitation.organizationId,
      });
    });
  }
}
