import { validate as isUuid } from 'uuid';
import { isDecimalString } from '../../../domain/amount.js';

// Helpers shared by the operator read models (ADR 0005).

/** Makes `%`, `_` and `\` match themselves in a LIKE pattern (Prisma does not). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

/** The id a search needle names, in the lower case the database stores; else null. */
export function uuidNeedle(needle: string): string | null {
  return isUuid(needle) ? needle.toLowerCase() : null;
}

/**
 * A stored JSON object as the string map the Console shows. Values that are
 * not strings are written as JSON so nothing is lost; anything that is not an
 * object gives an empty map.
 */
export function toStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === 'string' ? item : JSON.stringify(item),
    ]),
  );
}

/**
 * The amount the provider reported, kept in
 * `providerMetadata.providerReportedAmount`, as a decimal string. Null when
 * there is none or it is not a plain decimal.
 */
export function providerReportedAmount(metadata: unknown): string | null {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)['providerReportedAmount'];
  const text =
    typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return isDecimalString(text) ? text : null;
}
