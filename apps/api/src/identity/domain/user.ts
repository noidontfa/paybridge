/** The three fixed Roles. Access is decided by Permission, never by Role name. */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'ORGANIZATION_ADMIN',
  'OPERATOR',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

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
