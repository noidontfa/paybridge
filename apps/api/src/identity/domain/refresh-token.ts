export const ACCESS_TOKEN_TTL_MS = 5 * 60_000;
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const REFRESH_TOKEN_IDLE_MS = 24 * 60 * 60_000;

export interface RefreshToken {
  readonly id: string;
  /** Every token issued from one sign-in shares a family. */
  readonly familyId: string;
  readonly userId: string;
  readonly tokenHash: string;
  /** Absolute end of the family's life (7 days from sign-in). */
  readonly expiresAt: Date;
  /** End of this token's idle window (24 hours from its creation). */
  readonly idleExpiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
}

export type NewRefreshToken = Omit<RefreshToken, 'usedAt' | 'revokedAt'>;

export function isRefreshTokenLive(token: RefreshToken, now: Date): boolean {
  return (
    token.revokedAt === null &&
    token.usedAt === null &&
    now < token.expiresAt &&
    now < token.idleExpiresAt
  );
}
