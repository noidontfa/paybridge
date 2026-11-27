'use client';

import { InboxIcon, SearchXIcon } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { ClearFiltersButton, DataTableToolbar, FilterSelect, SearchInput } from '@/components/data-table/toolbar';
import { Button } from '@/components/ui/button';
import { CALLBACK_STATUSES } from '@/lib/api/callbacks';
import { CALLBACK_LIST_URL_CONFIG, useCallbackList } from '@/lib/queries/callbacks';
import { statusBadge } from '@/components/status-badges';
import { useTableUrlState } from '@/components/data-table/url-state/use-table-url-state';
import { callbackColumns, callbackHref } from './callbacks-columns';

/** The gateways the Console knows (only `stripe` and `fake` exist today). */
const GATEWAY_OPTIONS = ['stripe', 'fake'].map((id) => ({ value: id, label: id }));
const STATUS_OPTIONS = CALLBACK_STATUSES.map((status) => ({ value: status, label: statusBadge('callback', status).label }));

export function CallbacksScreen() {
  const { state, change, clear } = useTableUrlState(CALLBACK_LIST_URL_CONFIG);
  const list = useCallbackList(state);
  const filtered = state.q !== '' || Object.keys(state.filters).length > 0;
  const hasRows = list.rows.length > 0;

  const toolbar = useMemo(
    () => (
      <DataTableToolbar>
        <SearchInput
          label="Search Callbacks"
          placeholder="Callback id, Attempt Key or Payment"
          value={state.q}
          onChange={(q) => change({ q })}
        />
        <FilterSelect
          label="Gateway"
          allLabel="All gateways"
          value={state.filters.gatewayId ?? ''}
          options={GATEWAY_OPTIONS}
          onChange={(gatewayId) => change({ filters: { gatewayId } })}
        />
        <FilterSelect
          label="Status"
          allLabel="All statuses"
          value={state.filters.status ?? ''}
          options={STATUS_OPTIONS}
          onChange={(status) => change({ filters: { status } })}
        />
        {filtered && (hasRows || list.isPending) && <ClearFiltersButton onClick={clear} />}
      </DataTableToolbar>
    ),
    [state, change, clear, filtered, hasRows, list.isPending],
  );

  return (
    <div className="px-4 pb-4">
      <DataTable
        label="Callbacks"
        columns={callbackColumns}
        rows={list.rows}
        getRowId={(callback) => callback.id}
        getRowHref={callbackHref}
        sort={state.sort}
        onSortChange={() => {}}
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
            {filtered ? <SearchXIcon className="size-8 text-muted-foreground" aria-hidden /> : <InboxIcon className="size-8 text-muted-foreground" aria-hidden />}
            <h2 className="text-base font-medium">{filtered ? 'No Callbacks match these filters' : 'No Callbacks yet'}</h2>
            <p className="text-sm text-muted-foreground">
              {filtered ? 'Try a different search, gateway or status, or clear the filters.' : 'Notifications a PaymentGateway sends to PayBridge appear here.'}
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
