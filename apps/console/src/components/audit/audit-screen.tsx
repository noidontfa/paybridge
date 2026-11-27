'use client';

import { SearchXIcon } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { ClearFiltersButton, DataTableToolbar, FilterSelect, SearchInput } from '@/components/data-table/toolbar';
import { Button } from '@/components/ui/button';
import { STATUS_TRANSITION_ENTITY_TYPES } from '@/lib/api/schemas';
import { AUDIT_ACTORS, AUDIT_TRIGGERS, AUDIT_URL_CONFIG, useAuditList } from '@/lib/queries/audit-log';
import { useTableUrlState } from '@/components/data-table/url-state/use-table-url-state';
import { auditColumns, auditPaymentHref, ENTITY_TYPE_LABELS } from './audit-columns';

const ENTITY_OPTIONS = STATUS_TRANSITION_ENTITY_TYPES.map((type) => ({ value: type, label: ENTITY_TYPE_LABELS[type] }));
const TRIGGER_OPTIONS = AUDIT_TRIGGERS.map((trigger) => ({ value: trigger, label: trigger }));
const ACTOR_OPTIONS = AUDIT_ACTORS.map((actor) => ({ value: actor, label: actor }));
const NEWEST_FIRST = { id: 'createdAt', desc: true };

/** The Audit log: every status transition, filterable by entity type, trigger and actor. */
export function AuditScreen() {
  const { state, change, clear } = useTableUrlState(AUDIT_URL_CONFIG);
  const list = useAuditList(state);
  const filtered = state.q !== '' || Object.keys(state.filters).length > 0;
  const hasRows = list.rows.length > 0;

  const toolbar = useMemo(
    () => (
      <DataTableToolbar>
        <SearchInput
          label="Search Audit log"
          placeholder="Payment id or Upstream Reference"
          value={state.q}
          onChange={(q) => change({ q })}
        />
        <FilterSelect
          label="Entity type"
          allLabel="All entity types"
          value={state.filters.entityType ?? ''}
          options={ENTITY_OPTIONS}
          onChange={(entityType) => change({ filters: { entityType } })}
        />
        <FilterSelect
          label="Trigger"
          allLabel="All triggers"
          value={state.filters.trigger ?? ''}
          options={TRIGGER_OPTIONS}
          onChange={(trigger) => change({ filters: { trigger } })}
        />
        <FilterSelect
          label="Actor"
          allLabel="All actors"
          value={state.filters.actor ?? ''}
          options={ACTOR_OPTIONS}
          onChange={(actor) => change({ filters: { actor } })}
        />
        {filtered && (hasRows || list.isPending) && <ClearFiltersButton onClick={clear} />}
      </DataTableToolbar>
    ),
    [state, change, clear, filtered, hasRows, list.isPending],
  );

  return (
    <div className="px-4 pb-4">
      <DataTable
        label="Audit log"
        columns={auditColumns}
        rows={list.rows}
        getRowId={(entry) => entry.id}
        getRowHref={auditPaymentHref}
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
              {filtered ? 'No status transitions match these filters' : 'No status transitions yet'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {filtered ? 'Try a different search, trigger or actor, or clear the filters.' : 'Every status change Core makes is recorded here.'}
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
