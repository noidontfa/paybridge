import { randomBytes } from 'node:crypto';

/**
 * Every Publishable Key starts with this, distinct from API Keys
 * (`pb_live_`), so neither can be mistaken for the other.
 */
export const PUBLISHABLE_KEY_PREFIX = 'pb_pk_';

/**
 * A new key. It is public, but it is unguessable so that nobody can use an
 * Organization's checkout without having seen one of its pages.
 */
export function generatePublishableKey(): string {
  return `${PUBLISHABLE_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

export function looksLikePublishableKey(value: string): boolean {
  return value.startsWith(PUBLISHABLE_KEY_PREFIX) && value.length <= 200;
}
