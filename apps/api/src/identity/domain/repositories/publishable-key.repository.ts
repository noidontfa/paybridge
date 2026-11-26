import type {
  KeyWriter,
  NewPublishableKey,
  PublishableKey,
} from '../entities/publishable-key.js';

/** Persistence port for Publishable Keys. Implemented in `infrastructure/prisma`. */
export abstract class PublishableKeyRepository {
  abstract create(key: NewPublishableKey): Promise<PublishableKey>;
  abstract findByKey(key: string): Promise<PublishableKey | null>;
  /** A key of the Organization, or null when it has no such key. */
  abstract findOfOrganization(
    organizationId: string,
    id: string,
  ): Promise<PublishableKey | null>;
  /** The Organization's keys, newest first. */
  abstract listOfOrganization(organizationId: string): Promise<PublishableKey[]>;
  abstract setAllowedOrigins(
    organizationId: string,
    id: string,
    allowedOrigins: readonly string[],
    by: KeyWriter,
    at: Date,
  ): Promise<PublishableKey>;
  /** Revokes a key of the Organization if it is still active. */
  abstract revoke(
    organizationId: string,
    id: string,
    by: KeyWriter,
    at: Date,
  ): Promise<void>;
}
