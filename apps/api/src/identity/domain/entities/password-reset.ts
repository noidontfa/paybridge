/** A Password Reset link lives 30 minutes. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

export interface PasswordReset {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export type NewPasswordReset = Omit<PasswordReset, 'usedAt'>;
