/** The Overview range and how it lives in the URL (`/?range=24h`). */
export const OVERVIEW_RANGES = ['24h', '7d', '30d'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const DEFAULT_RANGE: OverviewRange = '7d';

export const RANGE_LABELS: Record<OverviewRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/** Reads a `range` search param; anything unknown falls back to the default. */
export function parseRange(
  value: string | string[] | undefined | null,
): OverviewRange {
  const first = Array.isArray(value) ? value[0] : value;
  return OVERVIEW_RANGES.find((range) => range === first) ?? DEFAULT_RANGE;
}

/** The Overview URL for a range; the default range keeps the URL clean. */
export function overviewHref(range: OverviewRange): string {
  return range === DEFAULT_RANGE ? '/' : `/?range=${range}`;
}
