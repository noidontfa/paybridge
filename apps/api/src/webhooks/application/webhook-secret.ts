import { randomBytes } from 'node:crypto';

/** Every signing secret starts with this, so a leaked one is easy to recognise. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_pb_';
/** Characters of the secret kept in clear text for display. */
const DISPLAY_LENGTH = WEBHOOK_SECRET_PREFIX.length + 6;

export interface GeneratedSecret {
  /** The full secret: the HMAC key, as UTF-8 bytes of this string. */
  readonly secret: string;
  readonly prefix: string;
}

/** A new signing secret with 256 bits of randomness. */
export function generateWebhookSecret(): GeneratedSecret {
  const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, DISPLAY_LENGTH) };
}
