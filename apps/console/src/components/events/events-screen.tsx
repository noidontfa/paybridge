'use client';

import { SearchXIcon } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { ClearFiltersButton, DataTableToolbar, FilterSelect, SearchInput } from '@/components/data-table/toolbar';
import { Button } from '@/components/ui/button';
import { PAYMENT_EVENT_TYPES } from '@/lib/api/schemas';
import { PAYMENT_EVENT_URL_CONFIG, usePaymentEventList } from '@/lib/queries/payment-events';
import { statusBadge } from '@/components/status-badges';
import { useTableUrlState } from '@/components/data-table/url-state/use-table-url-state';
import { eventColumns, eventHref } from './events-columns';

const TYPE_OPTIONS = PAYMENT_EVENT_TYPES.map((type) => ({ value: type, label: statusBadge('event', type).label }));
const PUBLISHED_OPTIONS = [
  { value: 'true', label: 'Published only' },
  { value: 'false', label: 'Unpublished only' },
];
const NEWEST_FIRST = { id: 'createdAt', desc: true };

/** The Events page: the outbox, filterable by type and by published or not. */
export function EventsScreen() {
  const { state, change, clear } = useTableUrlState(PAYMENT_EVENT_URL_CONFIG);
  const list = usePaymentEventList(state);
  const filtered = state.q !== '' || Object.keys(state.filters).length > 0;
  const hasRows = list.rows.length > 0;

  const toolbar = useMemo(
    () => (
      <DataTableToolbar>
        <SearchInput
          label="Search Payment Events"
          placeholder="Event id, Payment id or Upstream Reference"
          value={state.q}
          onChange={(q) => change({ q })}
        />
        <FilterSelect
          label="Type"
          allLabel="All types"
          value={state.filters.type ?? ''}
          options={TYPE_OPTIONS}
          onChange={(type) => change({ filters: { type } })}
        />
        <FilterSelect
          label="Published"
          allLabel="Published or not"
          value={state.filters.published ?? ''}
          options={PUBLISHED_OPTIONS}
          onChange={(published) => change({ filters: { published } })}
        />
        {filtered && (hasRows || list.isPending) && <ClearFiltersButton onClick={clear} />}
      </DataTableToolbar>
    ),
    [state, change, clear, filtered, hasRows, list.isPending],
  );

  return (
    <div className="px-4 pb-4">
      <DataTable
        label="Payment Events"
        columns={eventColumns}
        rows={list.rows}
        getRowId={(event) => event.id}
        getRowHref={eventHref}
        sort={NEWEST_FIRST}
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
            <SearchXIcon className="size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-base font-medium">
              {filtered ? 'No Payment Events match these filters' : 'No Payment Events yet'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {filtered ? 'Try a different search or type, or clear the filters.' : 'Events Core emits for a Payment appear here.'}
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
