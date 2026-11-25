'use client';

import { SidebarMenuBadge } from '@/components/ui/sidebar';
import { useReviewSummary } from '@/lib/queries/reviews';

/** The number of open Reviews beside Exceptions; nothing while unknown, failed or zero. */
export function OpenReviewsBadge() {
  const { data } = useReviewSummary();
  if (!data || data.open === 0) return null;
  return (
    <SidebarMenuBadge aria-label={`${data.open} open ${data.open === 1 ? 'Review' : 'Reviews'}`}>
      {data.open > 99 ? '99+' : data.open}
    </SidebarMenuBadge>
  );
}
