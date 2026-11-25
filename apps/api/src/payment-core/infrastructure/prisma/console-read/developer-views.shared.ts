import { validate as isUuid } from 'uuid';

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
