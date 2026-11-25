import type { Permission } from '../domain/permissions.js';
import type { UserRole } from '../domain/user.js';

/** What an access token says about the User it was issued to. */
export interface AccessClaims {
  readonly userId: string;
  readonly role: UserRole;
  /** Absent (null) for a Super Admin. */
  readonly organizationId: string | null;
  readonly permissions: readonly Permission[];
}

export interface JsonWebKeySet {
  readonly keys: readonly Record<string, unknown>[];
}

/** Signs and verifies access JWTs (ES256) and publishes the public keys. */
export abstract class AccessTokenService {
  abstract sign(claims: AccessClaims, now: Date): string;
  /** Returns the claims of a valid, unexpired token, or null for any other. */
  abstract verify(token: string, now: Date): AccessClaims | null;
  abstract jwks(): JsonWebKeySet;
}
