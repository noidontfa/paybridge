import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../identity/port/index.js';

/** Metadata key the access guard reads from an operator route. */
export const ACCESS_POLICY_KEY = 'access:policy';

/**
 * What an operator (`/internal`) route needs. A route must declare one:
 * the guard refuses a signed-in caller on a route that does not. Checks name
 * a Permission, never a Role.
 */
export type AccessPolicy =
  | {
      readonly permission: Permission;
      /**
       * A sensitive write re-reads the User, their Role and the
       * Organization in the database before it runs (ADR 0008).
       */
      readonly sensitive: boolean;
    }
  /** Any signed-in User, for their own session (no Permission to check). */
  | { readonly permission: null; readonly sensitive: false };

/** The route needs `permission`, checked against the access token. */
export const RequirePermission = (
  permission: Permission,
): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY_KEY, {
    permission,
    sensitive: false,
  } satisfies AccessPolicy);

/** A sensitive write: needs `permission`, re-checked in the database. */
export const RequireSensitivePermission = (
  permission: Permission,
): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY_KEY, {
    permission,
    sensitive: true,
  } satisfies AccessPolicy);

/** The route serves the signed-in User's own session; no Permission applies. */
export const SessionOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY_KEY, {
    permission: null,
    sensitive: false,
  } satisfies AccessPolicy);
