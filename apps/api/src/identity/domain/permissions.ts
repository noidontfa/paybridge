import type { UserRole } from './entities/user.js';

/** What a User may do. Checks are by Permission, never by Role name. */
export const PERMISSIONS = [
  'payments:view',
  'reviews:resolve',
  'users:manage',
  'api-keys:manage',
  'gateway-connections:manage',
  'organizations:manage',
  'super-admins:manage',
  'pricing:view',
  'pricing:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPERATOR: readonly Permission[] = [
  'payments:view',
  'reviews:resolve',
  'pricing:view',
];
const ORGANIZATION_ADMIN: readonly Permission[] = [
  ...OPERATOR,
  'users:manage',
  'api-keys:manage',
  'gateway-connections:manage',
  'pricing:manage',
];

/** The fixed Role-to-Permission map. Organization Admin is a superset of Operator. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OPERATOR,
  ORGANIZATION_ADMIN,
  SUPER_ADMIN: [
    ...ORGANIZATION_ADMIN,
    'organizations:manage',
    'super-admins:manage',
  ],
};

export function permissionsOf(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
