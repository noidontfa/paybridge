'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { listPayments, type PaymentListItem, type PaymentListQuery, type PaymentSortColumn } from '@/features/payments/api';
import { PAYMENT_SORT_COLUMNS } from '@/features/payments/api';
import { paymentKeys } from '@/features/payments/hooks/payments';
import type { TableUrlConfig, TableUrlState } from '@/components/data-table/url-state/table-url-state';

export const PAYMENT_LIST_URL_CONFIG: TableUrlConfig = {
  filters: ['status', 'gatewayId', 'createdFrom', 'createdTo'],
  sortable: PAYMENT_SORT_COLUMNS,
  defaultSort: { id: 'createdAt', desc: true },
};

export const paymentListKey = (query: PaymentListQuery) => [...paymentKeys.all, 'list', query] as const;

/** The table state as the endpoint's query (without the cursor, which is the page param). */
export function paymentListQuery(state: TableUrlState): PaymentListQuery {
  const { status, gatewayId, createdFrom, createdTo } = state.filters;
  return {
    q: state.q || undefined,
    status,
    gatewayId,
    createdFrom,
    createdTo,
    sort: state.sort.id as PaymentSortColumn,
    order: state.sort.desc ? 'desc' : 'asc',
  };
}

/** Pages accumulate ("load more"); a new filter, search or sort is a new query and starts again. */
export function usePaymentList(state: TableUrlState) {
  const query = paymentListQuery(state);
  const result = useInfiniteQuery({
    queryKey: paymentListKey({ ...query, cursor: state.cursor ?? undefined }),
    queryFn: ({ pageParam, signal }) => listPayments({ ...query, cursor: pageParam }, signal),
    initialPageParam: state.cursor ?? undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows: PaymentListItem[] = result.data?.pages.flatMap((page) => page.items) ?? EMPTY;
  return { ...result, rows };
}

const EMPTY: PaymentListItem[] = [];
