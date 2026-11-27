'use client';

import { InboxIcon, SearchXIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ClearFiltersButton, DataTableToolbar, FilterSelect, SearchInput } from '@/components/shared/data-table/toolbar';
import { Button } from '@/components/ui/button';
import { REVIEW_REASONS } from '@/features/payments/schemas';
import { useGatewayOptions } from '@/features/gateways/hooks/queries';
import { REVIEW_LIST_URL_CONFIG, useReviewList } from '@/features/reviews/hooks/reviews';
import type { ReviewItem } from '@/features/reviews/api';
import { statusBadge } from '@/components/shared/status-badges';
import { useTableUrlState } from '@/components/shared/data-table/url-state/use-table-url-state';
import { reviewColumns } from './exceptions-columns';

const REASON_OPTIONS = REVIEW_REASONS.map((reason) => ({ value: reason, label: statusBadge('review', reason).label }));

/** "Exceptions" in the UI; the domain term is Review. */
export function ExceptionsScreen() {
  const { state, change } = useTableUrlState(REVIEW_LIST_URL_CONFIG);
  const list = useReviewList(state);
  const gatewayOptions = useGatewayOptions();
  const router = useRouter();

  const closed = state.filters.state === 'closed';
  const filtered = Boolean(state.q || state.filters.reason || state.filters.gatewayId);
  const hasRows = list.rows.length > 0;

  /** A Review is its own route: a modal from here (intercepted), a full page on a reload. */
  const openReview = useCallback(
    (review: ReviewItem) => router.push(`/exceptions/${encodeURIComponent(review.payment.id)}/${encodeURIComponent(review.id)}`),
    [router],
  );
  const columns = useMemo(() => reviewColumns(openReview), [openReview]);
  const clearFilters = () => change({ q: '', filters: { reason: '', gatewayId: '' } });

  const toolbar = (
    <DataTableToolbar>
      <SearchInput
        label="Search Exceptions"
        placeholder="Payment id or Upstream Reference"
        value={state.q}
        onChange={(q) => change({ q })}
      />
      <div role="group" aria-label="Review state" className="flex gap-1">
        {(['open', 'closed'] as const).map((value) => (
          <Button
            key={value}
            variant={closed === (value === 'closed') ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={closed === (value === 'closed')}
            onClick={() => change({ filters: { state: value === 'closed' ? 'closed' : '' } })}
          >
            {value === 'open' ? 'Open' : 'Closed'}
          </Button>
        ))}
      </div>
      <FilterSelect
        label="Review reason"
        allLabel="All reasons"
        value={state.filters.reason ?? ''}
        options={REASON_OPTIONS}
        onChange={(reason) => change({ filters: { reason } })}
      />
      <FilterSelect
        label="Gateway"
        allLabel="All gateways"
        value={state.filters.gatewayId ?? ''}
        options={gatewayOptions}
        onChange={(gatewayId) => change({ filters: { gatewayId } })}
      />
      {/* With no rows the empty state offers the same action. */}
      {filtered && (hasRows || list.isPending) && <ClearFiltersButton onClick={clearFilters} />}
    </DataTableToolbar>
  );

  return (
    <div className="px-4 pb-4">
      <DataTable
        label="Exceptions"
        columns={columns}
        rows={list.rows}
        getRowId={(review) => review.id}
        onRowOpen={openReview}
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
            {filtered ? <SearchXIcon className="size-8 text-muted-foreground" aria-hidden /> : <InboxIcon className="size-8 text-muted-foreground" aria-hidden />}
            <h2 className="text-base font-medium">
              {filtered ? 'No Reviews match these filters' : closed ? 'No closed Reviews' : 'No open Reviews'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {filtered
                ? 'Try a different search, or clear the filters.'
                : closed
                  ? 'Reviews that an Operator has resolved appear here.'
                  : 'Nothing needs an Operator right now.'}
            </p>
            {filtered && (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
