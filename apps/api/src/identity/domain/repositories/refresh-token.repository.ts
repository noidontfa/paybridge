import type {
  NewRefreshToken,
  RefreshToken,
} from '../entities/refresh-token.js';

export abstract class RefreshTokenRepository {
  abstract create(token: NewRefreshToken): Promise<void>;
  abstract findByHash(tokenHash: string): Promise<RefreshToken | null>;
  /**
   * Marks the token used if it is not used or revoked yet. Returns false when
   * somebody else got there first (a replay or a race).
   */
  abstract markUsed(id: string, at: Date): Promise<boolean>;
  abstract revokeFamily(familyId: string, at: Date): Promise<void>;
  abstract revokeAllOfUser(userId: string, at: Date): Promise<void>;
  /** Revokes every open refresh token of the Organization's Users. */
  abstract revokeAllOfOrganization(
    organizationId: string,
    at: Date,
  ): Promise<void>;
  /** Revokes every family of the User except `keepFamilyId`. */
  abstract revokeAllOfUserExceptFamily(
    userId: string,
    keepFamilyId: string,
    at: Date,
  ): Promise<void>;
}
