import type { Invitation as InvitationRow } from '../../../generated/prisma/client.js';
import type { Invitation, NewInvitation } from '../../domain/entities/invitation.js';
import { InvitationRepository } from '../../domain/repositories/invitation.repository.js';
import type { DbContext } from './db.js';

function toInvitation(row: InvitationRow): Invitation {
  return { ...row };
}

/** Invitations in `iam_invitations`, by hash only. */
export class PrismaInvitationRepository extends InvitationRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(invitation: NewInvitation): Promise<Invitation> {
    return toInvitation(
      await this.ctx.db.invitation.create({ data: invitation }),
    );
  }

  async findById(id: string): Promise<Invitation | null> {
    const row = await this.ctx.db.invitation.findUnique({ where: { id } });
    return row ? toInvitation(row) : null;
  }

  async findByHash(tokenHash: string): Promise<Invitation | null> {
    const row = await this.ctx.db.invitation.findUnique({
      where: { tokenHash },
    });
    return row ? toInvitation(row) : null;
  }

  async findPendingByEmail(email: string, now: Date): Promise<Invitation[]> {
    const rows = await this.ctx.db.invitation.findMany({
      where: {
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    return rows.map(toInvitation);
  }

  async listPending(
    organizationId: string | null | undefined,
    now: Date,
  ): Promise<Invitation[]> {
    const rows = await this.ctx.db.invitation.findMany({
      where: {
        ...(organizationId === undefined ? {} : { organizationId }),
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInvitation);
  }

  async renew(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const { count } = await this.ctx.db.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { tokenHash, expiresAt },
    });
    return count === 1;
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const { count } = await this.ctx.db.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: at },
    });
    return count === 1;
  }

  async markAccepted(id: string, at: Date): Promise<boolean> {
    const { count } = await this.ctx.db.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: at },
    });
    return count === 1;
  }
}
