import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EmailTakenError,
  InvitationPendingError,
} from '../../domain/errors.js';
import { newIdentityId } from '../../domain/ids.js';
import { INVITATION_TTL_MS } from '../../domain/entities/invitation.js';
import {
  OrganizationNotFoundError,
  type Organization,
} from '../../domain/entities/organization.js';
import { normalizeEmail } from '../../domain/entities/user.js';
import { TransactionRunner } from '../../domain/repositories/transaction-runner.js';
import { IdentityClock } from '../../domain/services/clock.js';
import {
  hashInvitationToken,
  InvitationMailer,
} from './manage-invitations.js';

/**
 * A Super Admin creates an Organization together with the Invitation for its
 * first Organization Admin, in one transaction: either both exist or neither.
 */
@Injectable()
export class CreateOrganization {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(InvitationMailer) private readonly mailer: InvitationMailer,
  ) {}

  async execute(
    by: { userId: string },
    input: { name: string; adminEmail: string },
  ): Promise<Organization> {
    const email = normalizeEmail(input.adminEmail);
    const now = this.clock.now();
    const token = randomBytes(32).toString('base64url');
    const organization = await this.runner.run(async (repos) => {
      if (await repos.users.findByEmail(email)) throw new EmailTakenError(email);
      if ((await repos.invitations.findPendingByEmail(email, now)).length > 0) {
        throw new InvitationPendingError(email);
      }
      const created = await repos.organizations.create({
        id: newIdentityId(),
        name: input.name,
      });
      await repos.invitations.create({
        id: newIdentityId(),
        email,
        role: 'ORGANIZATION_ADMIN',
        organizationId: created.id,
        invitedById: by.userId,
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      });
      return created;
    });
    await this.mailer.send(email, token);
    return organization;
  }
}

/**
 * Suspends or reactivates an Organization. Suspension also revokes every
 * refresh token of its Users, so they are signed out when their access token
 * ends; sensitive writes and sign-in are refused at once because they read
 * the Organization's state from the database (ADR 0008).
 */
@Injectable()
export class SetOrganizationSuspension {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  suspend(organizationId: string): Promise<void> {
    return this.change(organizationId, true);
  }

  reactivate(organizationId: string): Promise<void> {
    return this.change(organizationId, false);
  }

  private change(organizationId: string, suspended: boolean): Promise<void> {
    const now = this.clock.now();
    return this.runner.run(async (repos) => {
      if (!(await repos.organizations.findById(organizationId))) {
        throw new OrganizationNotFoundError(organizationId);
      }
      await repos.organizations.setStatus(
        organizationId,
        suspended ? 'SUSPENDED' : 'ACTIVE',
      );
      if (suspended) {
        await repos.refreshTokens.revokeAllOfOrganization(organizationId, now);
      }
    });
  }
}
