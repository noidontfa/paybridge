/**
 * The API's three fixed Roles, named once. The Console never decides access by
 * Role name (use `useCan` with a Permission); Roles are only labels and the
 * values a Role change or Invitation sends.
 */
export const USER_ROLES = ['SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'OPERATOR'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The Roles an Organization's own Users can be moved between. */
export const MANAGED_ROLES = ['OPERATOR', 'ORGANIZATION_ADMIN'] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORGANIZATION_ADMIN: 'Organization Admin',
  OPERATOR: 'Operator',
};
