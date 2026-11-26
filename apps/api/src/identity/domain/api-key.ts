/**
 * An Organization's credential for the public payments API. The database
 * keeps a hash and a recognisable prefix; the full key is shown once.
 */
export interface ApiKey {
  readonly id: string;
  readonly organizationId: string;
  readonly label: string;
  /** The first characters of the key, safe to show (`pb_live_ab12cd34`). */
  readonly prefix: string;
  readonly keyHash: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export type NewApiKey = Pick<
  ApiKey,
  'id' | 'organizationId' | 'label' | 'prefix' | 'keyHash'
>;

export const API_KEY_LABEL_MAX = 100;

export class InvalidApiKeyLabelError extends Error {
  constructor() {
    super(`An API Key needs a label of 1 to ${API_KEY_LABEL_MAX} characters`);
    this.name = 'InvalidApiKeyLabelError';
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor(readonly apiKeyId: string) {
    super(`API Key ${apiKeyId} not found`);
    this.name = 'ApiKeyNotFoundError';
  }
}

/** The key is unknown, revoked, or its Organization is suspended. */
export class InvalidApiKeyError extends Error {
  constructor() {
    super('A valid API Key is required');
    this.name = 'InvalidApiKeyError';
  }
}

export function normaliseApiKeyLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > API_KEY_LABEL_MAX) {
    throw new InvalidApiKeyLabelError();
  }
  return trimmed;
}
