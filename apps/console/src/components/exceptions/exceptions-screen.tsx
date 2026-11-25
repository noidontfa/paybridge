'use client';

import { InboxIcon, SearchXIcon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { ClearFiltersButton, DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { Button } from '@/components/ui/button';
import { REVIEW_REASONS } from '@/lib/api/schemas';
import { REVIEW_LIST_URL_CONFIG, useReviewList } from '@/lib/queries/reviews';
import type { ReviewItem } from '@/lib/api/reviews';
import { statusBadge } from '@/lib/status-badges';
import { useTableUrlState } from '@/lib/url-state/use-table-url-state';
import { reviewColumns } from './exceptions-columns';
import { ReviewSheet } from './review-sheet';

/** The gateways the Console knows (only `stripe` and `fake` exist today). */
const GATEWAY_OPTIONS = ['stripe', 'fake'].map((id) => ({ value: id, label: id }));
const REASON_OPTIONS = REVIEW_REASONS.map((reason) => ({ value: reason, label: statusBadge('review', reason).label }));

/** The sheet is `?payment=<id>&transaction=<Attempt Key>`, next to whatever the table keeps in the URL. */
const SHEET_PARAMS = ['payment', 'transaction'] as const;

/** "Exceptions" in the UI; the domain term is Review. */
export function ExceptionsScreen() {
  const { state, change } = useTableUrlState(REVIEW_LIST_URL_CONFIG);
  const list = useReviewList(state);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const closed = state.filters.state === 'closed';
  const filtered = Boolean(state.filters.reason || state.filters.gatewayId);
  const hasRows = list.rows.length > 0;
  const paymentId = searchParams.get('payment');
  const transactionId = searchParams.get('transaction');

  const writeSheet = useCallback(
    (review: { paymentId: string; transactionId: string } | null) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const name of SHEET_PARAMS) params.delete(name);
      if (review) {
        params.set('payment', review.paymentId);
        params.set('transaction', review.transactionId);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const openReview = useCallback(
    (review: ReviewItem) => writeSheet({ paymentId: review.payment.id, transactionId: review.id }),
    [writeSheet],
  );
  const closeSheet = useCallback(() => writeSheet(null), [writeSheet]);
  const columns = useMemo(() => reviewColumns(openReview), [openReview]);
  const clearFilters = () => change({ filters: { reason: '', gatewayId: '' } });

  const toolbar = (
    <DataTableToolbar>
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
        options={GATEWAY_OPTIONS}
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
                ? 'Try a different reason or gateway, or clear the filters.'
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
      {paymentId && transactionId && <ReviewSheet paymentId={paymentId} transactionId={transactionId} onClose={closeSheet} />}
    </div>
  );
}
