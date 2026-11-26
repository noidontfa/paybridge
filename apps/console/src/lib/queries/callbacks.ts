'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  getCallback,
  listCallbacks,
  type CallbackListItem,
  type CallbackListQuery,
} from '@/lib/api/callbacks';
import type {
  TableUrlConfig,
  TableUrlState,
} from '@/lib/url-state/table-url-state';

export const callbackKeys = {
  all: ['callbacks'] as const,
  list: (query: CallbackListQuery) =>
    [...callbackKeys.all, 'list', query] as const,
  detail: (id: string) => [...callbackKeys.all, 'detail', id] as const,
};

/** Callbacks are always newest first; searchable, with two filters and no sort. */
export const CALLBACK_LIST_URL_CONFIG: TableUrlConfig = {
  filters: ['gatewayId', 'status'],
  sortable: [],
  defaultSort: { id: 'receivedAt', desc: true },
};

const EMPTY: CallbackListItem[] = [];

export function useCallbackList(state: TableUrlState) {
  const query: CallbackListQuery = {
    gatewayId: state.filters.gatewayId,
    status: state.filters.status,
    q: state.q || undefined,
  };
  const result = useInfiniteQuery({
    queryKey: callbackKeys.list({
      ...query,
      cursor: state.cursor ?? undefined,
    }),
    queryFn: ({ pageParam, signal }) =>
      listCallbacks({ ...query, cursor: pageParam }, signal),
    initialPageParam: state.cursor ?? undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = result.data?.pages.flatMap((page) => page.items) ?? EMPTY;
  return { ...result, rows };
}

export function useCallback(id: string) {
  return useQuery({
    queryKey: callbackKeys.detail(id),
    queryFn: ({ signal }) => getCallback(id, signal),
  });
}
