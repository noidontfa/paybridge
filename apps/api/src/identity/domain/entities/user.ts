import { ROLES, type Role } from '../../../common/principal/actor.js';

/** The three fixed Roles (one definition for every module, in `common`). */
export const USER_ROLES = ROLES;
export type UserRole = Role;

/** The Roles an Organization's own Users can be moved between. */
export const MANAGED_ROLES = ['OPERATOR', 'ORGANIZATION_ADMIN'] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

/** Human name of a Role, as the Console shows it. */
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORGANIZATION_ADMIN: 'Organization Admin',
  OPERATOR: 'Operator',
};

export interface User {
  readonly id: string;
  /** Lowercase, unique across PayBridge. */
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  /** Absent for a Super Admin, present for every other Role. */
  readonly organizationId: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly organizationId: string | null;
}

export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends Error {
  constructor() {
    super(`A password needs at least ${MIN_PASSWORD_LENGTH} characters`);
    this.name = 'WeakPasswordError';
  }
}

export function assertStrongPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new WeakPasswordError();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
