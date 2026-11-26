'use client';

/**
 * Query keys and hooks for Reviews (the Exceptions queue). Ticket 06's
 * resolution mutation invalidates `reviewKeys.all` (list and summary) and the
 * Payment detail.
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  getReviewSummary,
  listReviews,
  REVIEW_SORT_COLUMNS,
  type ReviewItem,
  type ReviewListQuery,
  type ReviewState,
} from '@/lib/api/reviews';
import type { ReviewReason } from '@/lib/api/schemas';
import type {
  TableUrlConfig,
  TableUrlState,
} from '@/lib/url-state/table-url-state';

export const reviewKeys = {
  all: ['reviews'] as const,
  list: (query: ReviewListQuery) => [...reviewKeys.all, 'list', query] as const,
  summary: () => [...reviewKeys.all, 'summary'] as const,
};

/** Oldest first by default: the longest-waiting Review is at the top. */
export const REVIEW_LIST_URL_CONFIG: TableUrlConfig = {
  filters: ['reason', 'gatewayId', 'state'],
  sortable: REVIEW_SORT_COLUMNS,
  defaultSort: { id: 'reviewOpenedAt', desc: false },
};

/** The table state as the endpoint's query (without the cursor, which is the page param). */
export function reviewListQuery(state: TableUrlState): ReviewListQuery {
  const { reason, gatewayId, state: reviewState } = state.filters;
  return {
    reason: reason as ReviewReason | undefined,
    gatewayId,
    q: state.q || undefined,
    state:
      reviewState === 'closed' ? ('closed' satisfies ReviewState) : undefined,
    sort: 'reviewOpenedAt',
    order: state.sort.desc ? 'desc' : 'asc',
  };
}

export function useReviewList(state: TableUrlState) {
  const query = reviewListQuery(state);
  const result = useInfiniteQuery({
    queryKey: reviewKeys.list({ ...query, cursor: state.cursor ?? undefined }),
    queryFn: ({ pageParam, signal }) =>
      listReviews({ ...query, cursor: pageParam }, signal),
    initialPageParam: state.cursor ?? undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows: ReviewItem[] =
    result.data?.pages.flatMap((page) => page.items) ?? EMPTY;
  return { ...result, rows };
}

const EMPTY: ReviewItem[] = [];

/** Open Reviews, in total and by reason: drives the sidebar badge. */
export function useReviewSummary() {
  return useQuery({
    queryKey: reviewKeys.summary(),
    queryFn: ({ signal }) => getReviewSummary(signal),
  });
}
