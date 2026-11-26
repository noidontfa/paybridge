import type { ApiKey, NewApiKey } from '../domain/api-key.js';

/** Persistence port for API Keys. Implemented in `infrastructure/prisma`. */
export abstract class ApiKeyRepository {
  abstract create(key: NewApiKey): Promise<ApiKey>;
  abstract findByHash(keyHash: string): Promise<ApiKey | null>;
  /** The Organization's keys, newest first. */
  abstract listOfOrganization(organizationId: string): Promise<ApiKey[]>;
  /** Revokes a key of the Organization; false when it has no such key. */
  abstract revoke(
    organizationId: string,
    id: string,
    at: Date,
  ): Promise<boolean>;
  abstract touch(id: string, at: Date): Promise<void>;
}
