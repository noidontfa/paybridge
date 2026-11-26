import type {
  NewPasswordReset,
  PasswordReset,
} from '../domain/password-reset.js';

export abstract class PasswordResetRepository {
  abstract create(reset: NewPasswordReset): Promise<void>;
  abstract findByHash(tokenHash: string): Promise<PasswordReset | null>;
  /** Marks the link used if it is not used yet; false when it already was. */
  abstract markUsed(id: string, at: Date): Promise<boolean>;
  /** Voids every unused link of a User (a newer request replaces them). */
  abstract voidUnusedOfUser(userId: string, at: Date): Promise<void>;
}
