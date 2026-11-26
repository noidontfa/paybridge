import type { Invitation, NewInvitation } from '../entities/invitation.js';

export abstract class InvitationRepository {
  abstract create(invitation: NewInvitation): Promise<Invitation>;
  abstract findById(id: string): Promise<Invitation | null>;
  abstract findByHash(tokenHash: string): Promise<Invitation | null>;
  /** Pending Invitations of an email (any Organization). */
  abstract findPendingByEmail(email: string, now: Date): Promise<Invitation[]>;
  /**
   * Pending Invitations, newest first. `organizationId` filters to one
   * Organization (null: the Super Admin ones); `undefined` means all.
   */
  abstract listPending(
    organizationId: string | null | undefined,
    now: Date,
  ): Promise<Invitation[]>;
  /** Replaces the link and expiry of a not-accepted, not-revoked Invitation. */
  abstract renew(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  /** False when it was already accepted or revoked. */
  abstract revoke(id: string, at: Date): Promise<boolean>;
  /** False when it was already accepted or revoked. */
  abstract markAccepted(id: string, at: Date): Promise<boolean>;
}
