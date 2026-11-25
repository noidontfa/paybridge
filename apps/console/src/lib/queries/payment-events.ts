'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getPaymentEvent,
  listPaymentEvents,
  type PaymentEventListQuery,
  type PaymentEventSummary,
} from '@/lib/api/payment-events';
import { paymentEventTypeSchema } from '@/lib/api/schemas';
import type { TableUrlConfig, TableUrlState } from '@/lib/url-state/table-url-state';

/** The outbox is always newest first, so there is nothing to sort in the URL. */
export const PAYMENT_EVENT_URL_CONFIG: TableUrlConfig = {
  filters: ['type', 'published'],
  sortable: [],
  defaultSort: { id: 'createdAt', desc: true },
};

export const paymentEventKeys = {
  all: ['payment-events'] as const,
  list: (query: PaymentEventListQuery) => [...paymentEventKeys.all, 'list', query] as const,
  detail: (id: string) => [...paymentEventKeys.all, 'detail', id] as const,
};

/** The table state as the endpoint's query; a value the endpoint would reject is dropped. */
export function paymentEventListQuery(state: TableUrlState): PaymentEventListQuery {
  const type = paymentEventTypeSchema.safeParse(state.filters.type);
  const { published } = state.filters;
  return {
    type: type.success ? type.data : undefined,
    published: published === 'true' || published === 'false' ? published : undefined,
  };
}

const EMPTY: PaymentEventSummary[] = [];

export function usePaymentEventList(state: TableUrlState) {
  const query = paymentEventListQuery(state);
  const result = useInfiniteQuery({
    queryKey: paymentEventKeys.list({ ...query, cursor: state.cursor ?? undefined }),
    queryFn: ({ pageParam, signal }) => listPaymentEvents({ ...query, cursor: pageParam }, signal),
    initialPageParam: state.cursor ?? undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = result.data?.pages.flatMap((page) => page.items) ?? EMPTY;
  return { ...result, rows };
}

export function usePaymentEvent(id: string) {
  return useQuery({
    queryKey: paymentEventKeys.detail(id),
    queryFn: ({ signal }) => getPaymentEvent(id, signal),
  });
}
