import { createHmac } from 'node:crypto';

/**
 * The header every Webhook carries: `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`.
 * Each `v1` is HMAC-SHA256 of `<t>.<raw body>` under one valid signing
 * secret (several during a rotation). Receivers recompute it over the raw
 * body, compare in constant time, and reject a `t` older than five minutes.
 */
export const SIGNATURE_HEADER = 'paybridge-signature';

export function signatureHeader(
  secrets: readonly string[],
  at: Date,
  rawBody: string,
): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const signatures = secrets.map(
    (secret) =>
      `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`,
  );
  return [`t=${timestamp}`, ...signatures].join(',');
}
