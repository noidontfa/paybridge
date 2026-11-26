import type { UserRole } from './user.js';

/** An Invitation link lives 7 days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

export interface Invitation {
  readonly id: string;
  /** Lowercase. */
  readonly email: string;
  readonly role: UserRole;
  /** Absent for a Super Admin. */
  readonly organizationId: string | null;
  readonly invitedById: string | null;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export type NewInvitation = Omit<
  Invitation,
  'createdAt' | 'acceptedAt' | 'revokedAt'
>;

/** Pending: not accepted, not revoked and not yet expired. */
export function isPending(invitation: Invitation, now: Date): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    now < invitation.expiresAt
  );
}
