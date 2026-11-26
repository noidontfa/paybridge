import { createHash, randomBytes } from 'node:crypto';

/** Every API Key starts with this, so a leaked one is easy to recognise. */
export const API_KEY_PREFIX = 'pb_live_';
/** Characters of the key kept in clear text for display. */
const DISPLAY_LENGTH = API_KEY_PREFIX.length + 8;

export interface GeneratedApiKey {
  readonly key: string;
  readonly prefix: string;
  readonly keyHash: string;
}

/**
 * A key has 256 bits of randomness, so a plain SHA-256 is enough to store
 * it (no password-style stretching is needed).
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    key,
    prefix: key.slice(0, DISPLAY_LENGTH),
    keyHash: hashApiKey(key),
  };
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length <= 200;
}
