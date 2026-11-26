import { format, formatDistanceStrict } from 'date-fns';

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const GROUPING_LOCALE = 'vi-VN';

/**
 * Formats a decimal string in the currency's major unit as VND ("150.000 ₫").
 * The amount is never converted to a float: the integer part is grouped as a
 * BigInt and the fraction is carried over as text (trailing zeros dropped).
 */
export function formatMoney(amount: string): string {
  const match = DECIMAL.exec(amount);
  if (!match) throw new Error(`Not a decimal string: "${amount}"`);
  const [, sign, integer, fraction = ''] = match;
  const grouped = BigInt(integer).toLocaleString(GROUPING_LOCALE);
  const trimmed = fraction.replace(/0+$/, '');
  return `${sign}${grouped}${trimmed ? `,${trimmed}` : ''} ₫`;
}

/** Local absolute time, e.g. "25 Nov 2026, 14:30:05". */
export function formatAbsoluteTime(iso: string): string {
  return format(new Date(iso), 'dd MMM yyyy, HH:mm:ss');
}

/** Relative hint such as "3 days ago" or "in 2 hours". */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  return formatDistanceStrict(new Date(iso), now, { addSuffix: true });
}

/** A duration since `iso`, such as "3 days", for "open for 3 days". */
export function formatOpenFor(iso: string, now: Date = new Date()): string {
  return formatDistanceStrict(new Date(iso), now);
}

/** "REQUIRES_REVIEW" or "CLIENT_SDK" as "Requires review" or "Client sdk"; for values with no curated label. */
export function humanizeCode(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
