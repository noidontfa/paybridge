// Who made a change, as every module records it (on its own rows: ADR 0010)
// and shows it back. One shape, one Role type and one label rule for all.

/** The three fixed Roles. Access is decided by Permission, never by Role name. */
export const ROLES = ['SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'OPERATOR'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return (ROLES as readonly unknown[]).includes(value);
}

/**
 * A Role read back from a module's own audit columns. They only ever hold
 * a Role this code wrote, so anything else is a bug worth failing on.
 */
export function roleOf(value: string): Role {
  if (!isRole(value))
    throw new Error(`Unknown Role "${value}" in an audit record`);
  return value;
}

/** The signed-in User making a change, and the Role they hold now. */
export interface Actor {
  readonly userId: string;
  readonly role: Role;
  /** Known once a sensitive write re-read the User (ADR 0008); else empty. */
  readonly name: string;
}

/** How a Super Admin's changes are shown to an Organization: as the platform. */
export const PLATFORM_LABEL = 'Super Admin (PayBridge)';

/** The label a writer is shown with: the platform for a Super Admin, else none. */
export function actorLabel(actor: {
  readonly role: string | null;
}): string | null {
  return actor.role === 'SUPER_ADMIN' ? PLATFORM_LABEL : null;
}
