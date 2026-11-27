import type {
  OrganizationScope,
  ReadScope,
} from '../../../common/organization-scope.js';
import type {
  Actor,
  NewPublishableKey,
  PublishableKey,
} from '../entities/publishable-key.js';

/**
 * Persistence port for Publishable Keys (`iam_publishable_keys`). Every
 * method takes the Organization scope first (ADR 0006). Implemented in
 * `infrastructure/prisma`.
 */
export abstract class PublishableKeyRepository {
  abstract create(
    scope: OrganizationScope,
    key: NewPublishableKey,
  ): Promise<PublishableKey>;
  /**
   * The key a browser presented. Before it is found nobody knows its
   * Organization, so the checkout guard asks across all of them.
   */
  abstract findByKey(
    scope: ReadScope,
    key: string,
  ): Promise<PublishableKey | null>;
  /** A key of the Organization, or null when it has no such key. */
  abstract findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<PublishableKey | null>;
  /** The Organization's keys, newest first. */
  abstract list(scope: OrganizationScope): Promise<PublishableKey[]>;
  abstract setAllowedOrigins(
    scope: OrganizationScope,
    id: string,
    allowedOrigins: readonly string[],
    by: Actor,
    at: Date,
  ): Promise<PublishableKey>;
  /** Revokes a key of the Organization if it is still active. */
  abstract revoke(
    scope: OrganizationScope,
    id: string,
    by: Actor,
    at: Date,
  ): Promise<void>;
}
