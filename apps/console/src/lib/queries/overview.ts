'use client';

import { useQuery } from '@tanstack/react-query';
import { getOverview } from '@/lib/api/client';
import type { OverviewRange } from '@/lib/overview-range';

/** The review-resolution mutation (ticket 06) invalidates `overviewKeys.all`. */
export const overviewKeys = {
  all: ['overview'] as const,
  range: (range: OverviewRange) => [...overviewKeys.all, range] as const,
};

export function useOverview(range: OverviewRange) {
  return useQuery({
    queryKey: overviewKeys.range(range),
    queryFn: ({ signal }) => getOverview(range, signal),
  });
}
