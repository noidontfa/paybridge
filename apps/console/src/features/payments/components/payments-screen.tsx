'use client';

import { SearchXIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ClearFiltersButton, DataTableToolbar, DateFilter, FilterSelect, SearchInput } from '@/components/shared/data-table/toolbar';
import { DataTable } from '@/components/shared/data-table/data-table';
import { Button } from '@/components/ui/button';
import { PAYMENT_STATUSES } from '@/features/payments/schemas';
import { statusBadge } from '@/components/shared/status-badges';
import { useGatewayOptions } from '@/features/gateways/hooks/queries';
import { PAYMENT_LIST_URL_CONFIG, usePaymentList } from '@/features/payments/hooks/payments-list';
import { useTableUrlState } from '@/components/shared/data-table/url-state/use-table-url-state';
import { paymentColumns, paymentHref } from './payments-columns';

const STATUS_OPTIONS = PAYMENT_STATUSES.map((status) => ({ value: status, label: statusBadge('payment', status).label }));

export function PaymentsScreen() {
  const { state, change, clear } = useTableUrlState(PAYMENT_LIST_URL_CONFIG);
  const list = usePaymentList(state);
  const gatewayOptions = useGatewayOptions();
  const filtered = state.q !== '' || Object.keys(state.filters).length > 0;
  const hasRows = list.rows.length > 0;

  const toolbar = useMemo(
    () => (
      <DataTableToolbar>
        <SearchInput
          label="Search Payments"
          placeholder="Payment id or Upstream Reference"
          value={state.q}
          onChange={(q) => change({ q })}
        />
        <FilterSelect
          label="Status"
          allLabel="All statuses"
          value={state.filters.status ?? ''}
          options={STATUS_OPTIONS}
          onChange={(status) => change({ filters: { status } })}
        />
        <FilterSelect
          label="Gateway"
          allLabel="All gateways"
          value={state.filters.gatewayId ?? ''}
          options={gatewayOptions}
          onChange={(gatewayId) => change({ filters: { gatewayId } })}
        />
        <DateFilter label="Created from" value={state.filters.createdFrom ?? ''} onChange={(createdFrom) => change({ filters: { createdFrom } })} />
        <DateFilter label="Created to" value={state.filters.createdTo ?? ''} onChange={(createdTo) => change({ filters: { createdTo } })} />
        {/* With no rows the empty state offers the same action. */}
        {filtered && (hasRows || list.isPending) && <ClearFiltersButton onClick={clear} />}
      </DataTableToolbar>
    ),
    [state, change, clear, filtered, hasRows, list.isPending, gatewayOptions],
  );

  return (
    <div className="px-4 pb-4">
      <DataTable
        label="Payments"
        columns={paymentColumns}
        rows={list.rows}
        getRowId={(payment) => payment.id}
        getRowHref={paymentHref}
        sort={state.sort}
        onSortChange={(sort) => change({ sort })}
        isLoading={list.isPending}
        isRefreshing={list.isPlaceholderData}
        error={list.error}
        onRetry={() => (list.isFetchNextPageError ? void list.fetchNextPage() : void list.refetch())}
        hasMore={list.hasNextPage}
        isLoadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        toolbar={toolbar}
        emptyState={
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
            <SearchXIcon className="size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-base font-medium">{filtered ? 'No Payments match these filters' : 'No Payments yet'}</h2>
            <p className="text-sm text-muted-foreground">
              {filtered ? 'Try a different search, or clear the filters.' : 'Payments created through the API appear here.'}
            </p>
            {filtered && (
              <Button variant="outline" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
