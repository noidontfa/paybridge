import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import {
  EmailTakenError,
  InvitationNotFoundError,
  InvitationPendingError,
  InvitationRoleForbiddenError,
  OrganizationRequiredError,
} from '../../domain/errors.js';
import { newIdentityId } from '../../domain/ids.js';
import {
  INVITATION_TTL_MS,
  type Invitation,
} from '../../domain/invitation.js';
import { normalizeEmail, type UserRole } from '../../domain/user.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { IdentityClock } from '../../port/clock.js';
import { EmailSender } from '../../port/email-sender.js';

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Who manages Invitations, as the principal describes them. */
export interface InvitationManager {
  readonly userId: string;
  /** The Organization they work in (a Super Admin: the one they chose). */
  readonly organizationId: string | null;
  /** The Super Admin may also see every Organization's (read only). */
  readonly allOrganizations?: boolean;
  readonly permissions: readonly string[];
}

const canManageSuperAdmins = (m: InvitationManager): boolean =>
  m.permissions.includes('super-admins:manage');

/** Whether the manager may see or change an Invitation. */
function mayManage(m: InvitationManager, invitation: Invitation): boolean {
  if (invitation.role === 'SUPER_ADMIN') return canManageSuperAdmins(m);
  return m.organizationId !== null && invitation.organizationId === m.organizationId;
}

@Injectable()
class InvitationMailer {
  constructor(
    @Inject(EmailSender) private readonly email: EmailSender,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async send(to: string, token: string): Promise<void> {
    const base = this.config
      .get('CONSOLE_BASE_URL', { infer: true })
      .replace(/\/$/, '');
    await this.email.send({
      to,
      subject: 'You are invited to PayBridge',
      body: 'Use the link to set your password and join. It works once and expires in 7 days.',
      link: `${base}/accept-invitation?token=${encodeURIComponent(token)}`,
    });
  }
}

const newToken = (): string => randomBytes(32).toString('base64url');

/** An Organization Admin or Super Admin invites an email with a Role. */
@Injectable()
export class SendInvitation {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(InvitationMailer) private readonly mailer: InvitationMailer,
  ) {}

  async execute(
    by: InvitationManager,
    input: { email: string; role: UserRole },
  ): Promise<Invitation> {
    let organizationId: string | null;
    if (input.role === 'SUPER_ADMIN') {
      if (!canManageSuperAdmins(by)) throw new InvitationRoleForbiddenError();
      organizationId = null;
    } else {
      if (by.organizationId === null) throw new OrganizationRequiredError();
      organizationId = by.organizationId;
    }
    const email = normalizeEmail(input.email);
    const now = this.clock.now();
    const token = newToken();

    const invitation = await this.runner.run(async (repos) => {
      if (await repos.users.findByEmail(email)) throw new EmailTakenError(email);
      if ((await repos.invitations.findPendingByEmail(email, now)).length > 0) {
        throw new InvitationPendingError(email);
      }
      return repos.invitations.create({
        id: newIdentityId(),
        email,
        role: input.role,
        organizationId,
        invitedById: by.userId,
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      });
    });
    await this.mailer.send(email, token);
    return invitation;
  }
}

/** Replaces the link (voiding the previous one) and restarts the 7 days. */
@Injectable()
export class ResendInvitation {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(InvitationMailer) private readonly mailer: InvitationMailer,
  ) {}

  async execute(by: InvitationManager, id: string): Promise<void> {
    const now = this.clock.now();
    const token = newToken();
    const email = await this.runner.run(async (repos) => {
      const invitation = await repos.invitations.findById(id);
      if (!invitation || !mayManage(by, invitation)) {
        throw new InvitationNotFoundError();
      }
      const renewed = await repos.invitations.renew(
        id,
        hashInvitationToken(token),
        new Date(now.getTime() + INVITATION_TTL_MS),
      );
      if (!renewed) throw new InvitationNotFoundError();
      return invitation.email;
    });
    await this.mailer.send(email, token);
  }
}

@Injectable()
export class RevokeInvitation {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(by: InvitationManager, id: string): Promise<void> {
    const now = this.clock.now();
    await this.runner.run(async (repos) => {
      const invitation = await repos.invitations.findById(id);
      if (!invitation || !mayManage(by, invitation)) {
        throw new InvitationNotFoundError();
      }
      if (!(await repos.invitations.revoke(id, now))) {
        throw new InvitationNotFoundError();
      }
    });
  }
}

/** Pending Invitations the manager may see, newest first. */
@Injectable()
export class ListPendingInvitations {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
  ) {}

  async execute(by: InvitationManager): Promise<Invitation[]> {
    const scope = by.allOrganizations ? undefined : by.organizationId;
    const rows = await this.runner.repositories.invitations.listPending(
      scope,
      this.clock.now(),
    );
    return rows.filter((row) => mayManageOrAll(by, row));
  }
}

function mayManageOrAll(by: InvitationManager, row: Invitation): boolean {
  if (by.allOrganizations) {
    return row.role !== 'SUPER_ADMIN' || canManageSuperAdmins(by);
  }
  return mayManage(by, row);
}

export { InvitationMailer };
