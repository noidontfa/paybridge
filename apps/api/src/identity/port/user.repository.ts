import type { NewUser, User } from '../domain/user.js';

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  /** `email` must already be normalized (lowercase). */
  abstract findByEmail(email: string): Promise<User | null>;
  abstract create(user: NewUser): Promise<User>;
  /** Changes the password only; unlike `resetPassword` it never reactivates. */
  abstract setPasswordHash(id: string, passwordHash: string): Promise<void>;
  /** Recovery: sets a new password hash and makes the User active again. */
  abstract resetPassword(id: string, passwordHash: string): Promise<void>;
}
