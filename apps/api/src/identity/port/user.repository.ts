import type { NewUser, User, UserRole } from '../domain/user.js';

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  /** `email` must already be normalized (lowercase). */
  abstract findByEmail(email: string): Promise<User | null>;
  abstract create(user: NewUser): Promise<User>;
  /** Changes the password only; unlike `resetPassword` it never reactivates. */
  abstract setPasswordHash(id: string, passwordHash: string): Promise<void>;
  /** Recovery: sets a new password hash and makes the User active again. */
  abstract resetPassword(id: string, passwordHash: string): Promise<void>;
  /** Every User of the Organization, by name. */
  abstract listByOrganization(organizationId: string): Promise<User[]>;
  /** Changes Role and/or the active flag. */
  abstract update(
    id: string,
    changes: { role?: UserRole; active?: boolean },
  ): Promise<void>;
  /** Every Super Admin, by name. */
  abstract listSuperAdmins(): Promise<User[]>;
  /** Locks every Super Admin row until the transaction ends. */
  abstract lockSuperAdmins(): Promise<void>;
  /** Active Super Admins, not counting `exceptUserId`. */
  abstract countActiveSuperAdmins(exceptUserId: string): Promise<number>;
  /** Active Organization Admins of the Organization, not counting `exceptUserId`. */
  abstract countActiveAdmins(
    organizationId: string,
    exceptUserId: string,
  ): Promise<number>;
}
