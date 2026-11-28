'use client';

import { SearchXIcon, SendIcon } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ClearFiltersButton, DataTableToolbar, FilterSelect } from '@/components/shared/data-table/toolbar';
import { Button } from '@/components/ui/button';
import { WEBHOOK_DELIVERY_KINDS, WEBHOOK_DELIVERY_STATUSES } from '@/features/webhooks/api/webhook-deliveries';
import { WEBHOOK_DELIVERY_LIST_URL_CONFIG, useWebhookDeliveryList } from '@/features/webhooks/hooks/webhook-deliveries';
import { useWebhookEndpoints } from '@/features/webhooks/hooks/webhook-endpoints';
import { useCan } from '@/features/auth/hooks/use-operator';
import { statusBadge } from '@/components/shared/status-badges';
import { useTableUrlState } from '@/components/shared/data-table/url-state/use-table-url-state';
import { webhookDeliveryColumns, webhookDeliveryHref } from './webhook-deliveries-columns';

const STATUS_OPTIONS = WEBHOOK_DELIVERY_STATUSES.map((status) => ({ value: status, label: statusBadge('webhookDelivery', status).label }));
const KIND_OPTIONS = WEBHOOK_DELIVERY_KINDS.map((kind) => ({ value: kind, label: kind }));

/** The endpoint filter's options; only an Admin may list endpoints, so others filter by status and kind. */
function useEndpointOptions(): { value: string; label: string }[] | null {
  const canList = useCan('webhook-endpoints:manage');
  const endpoints = useWebhookEndpoints(canList);
  if (!canList || !endpoints.data) return null;
  return endpoints.data.items.map((e) => ({ value: e.id, label: e.url }));
}

export function WebhookDeliveriesScreen() {
  const { state, change, clear } = useTableUrlState(WEBHOOK_DELIVERY_LIST_URL_CONFIG);
  const list = useWebhookDeliveryList(state);
  const endpointOptions = useEndpointOptions();
  const filtered = Object.keys(state.filters).length > 0;
  const hasRows = list.rows.length > 0;

  const toolbar = useMemo(
    () => (
      <DataTableToolbar>
        {endpointOptions && (
          <FilterSelect
            label="Webhook Endpoint"
            allLabel="All endpoints"
            value={state.filters.endpointId ?? ''}
            options={endpointOptions}
            onChange={(endpointId) => change({ filters: { endpointId } })}
          />
        )}
        <FilterSelect
          label="Status"
          allLabel="All statuses"
          value={state.filters.status ?? ''}
          options={STATUS_OPTIONS}
          onChange={(status) => change({ filters: { status } })}
        />
        <FilterSelect
          label="Event"
          allLabel="All events"
          value={state.filters.kind ?? ''}
          options={KIND_OPTIONS}
          onChange={(kind) => change({ filters: { kind } })}
        />
        {filtered && (hasRows || list.isPending) && <ClearFiltersButton onClick={clear} />}
      </DataTableToolbar>
    ),
    [state, change, clear, filtered, hasRows, list.isPending, endpointOptions],
  );

  return (
    <div className="px-4 pb-4">
      <DataTable
        label="Webhook deliveries"
        columns={webhookDeliveryColumns}
        rows={list.rows}
        getRowId={(delivery) => delivery.id}
        getRowHref={webhookDeliveryHref}
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
            {filtered ? <SearchXIcon className="size-8 text-muted-foreground" aria-hidden /> : <SendIcon className="size-8 text-muted-foreground" aria-hidden />}
            <h2 className="text-base font-medium">{filtered ? 'No deliveries match these filters' : 'No Webhook deliveries yet'}</h2>
            <p className="text-sm text-muted-foreground">
              {filtered
                ? 'Try a different endpoint, status or event, or clear the filters.'
                : 'Each Payment Event sent to one of your Webhook Endpoints appears here.'}
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
