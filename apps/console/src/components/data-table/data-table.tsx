'use client';

/**
 * The shared data table: one TanStack Table (v9) setup for every list screen.
 *
 * The server owns sorting, filtering and paging, so Table runs in manual mode:
 * it holds the column definitions and the sorting state (controlled from the
 * URL), and the screen feeds it the rows that are already sorted and filtered.
 * Paging is cursor-based "load more" (a cursor cannot jump to page N).
 *
 * Extension point: a list screen defines its columns (`DataTableColumns<Row>`,
 * built with `createDataTableColumnHelper`), passes its rows, sort and the
 * query status, and puts its filter controls in `toolbar` (see `./toolbar.tsx`).
 * Loading, empty and error states and the density come for free; the density
 * is the `data-density` attribute Settings puts on the root element.
 */
import { columnFilteringFeature, createColumnHelper, rowSortingFeature, tableFeatures, useTable } from '@tanstack/react-table';
import type { ColumnDef, RowData, SortingState } from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { ErrorState } from '@/components/data-states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SortState } from '@/lib/url-state/table-url-state';
import { cn } from '@/lib/utils';

export const dataTableFeatures = tableFeatures({ rowSortingFeature, columnFilteringFeature });
export type DataTableColumns<Row extends RowData> = ColumnDef<typeof dataTableFeatures, Row>[];

export function createDataTableColumnHelper<Row extends RowData>() {
  return createColumnHelper<typeof dataTableFeatures, Row>();
}

/** Column `meta`: `align: 'right'` for numbers. */
export interface DataTableColumnMeta {
  align?: 'right';
}

const SKELETON_ROWS = 8;

export interface DataTableProps<Row extends RowData> {
  /** Accessible name of the table. */
  label: string;
  columns: DataTableColumns<Row>;
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Where a click on the row goes. */
  getRowHref: (row: Row) => string;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** First load, or a new query with nothing to show yet. */
  isLoading: boolean;
  /** The query is fetching something new while old rows are shown. */
  isRefreshing?: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Rendered instead of the table when there are no rows. */
  emptyState: ReactNode;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Shown above the table: search and filter controls. */
  toolbar?: ReactNode;
}

export function DataTable<Row extends RowData>({
  label,
  columns,
  rows,
  getRowId,
  getRowHref,
  sort,
  onSortChange,
  isLoading,
  isRefreshing = false,
  error,
  onRetry,
  emptyState,
  hasMore,
  isLoadingMore,
  onLoadMore,
  toolbar,
}: DataTableProps<Row>) {
  const router = useRouter();
  const sorting: SortingState = [{ id: sort.id, desc: sort.desc }];
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId,
    manualSorting: true,
    manualFiltering: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    sortDescFirst: true,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const first = next[0];
      if (first) onSortChange({ id: first.id, desc: first.desc });
    },
  });

  const failedFirstLoad = error !== null && rows.length === 0;
  const showEmpty = !isLoading && !failedFirstLoad && rows.length === 0;

  const openRow = (event: MouseEvent, row: Row) => {
    // Links and buttons inside the row keep their own behaviour.
    if ((event.target as HTMLElement).closest('a, button')) return;
    router.push(getRowHref(row));
  };

  return (
    <div className="flex flex-col gap-3">
      {toolbar}
      {failedFirstLoad ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : showEmpty ? (
        emptyState
      ) : (
        <div className="rounded-xl border">
          <Table aria-label={label} aria-busy={isLoading || isRefreshing} className={cn(isRefreshing && 'opacity-60')}>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => {
                    const align = (header.column.columnDef.meta as DataTableColumnMeta | undefined)?.align;
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        className={align === 'right' ? 'text-right' : undefined}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn('-mx-2 h-8', align === 'right' && 'flex-row-reverse')}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={header} />
                            {sorted === 'asc' ? (
                              <ArrowUpIcon aria-hidden />
                            ) : sorted === 'desc' ? (
                              <ArrowDownIcon aria-hidden />
                            ) : (
                              <ArrowUpDownIcon aria-hidden className="opacity-50" />
                            )}
                          </Button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <TableRow key={index} className="hover:bg-transparent">
                      {columns.map((_column, cell) => (
                        <TableCell key={cell}>
                          <Skeleton className="h-4 w-full min-w-16" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer" onClick={(event) => openRow(event, row.original)}>
                      {row.getAllCells().map((cell) => {
                        const align = (cell.column.columnDef.meta as DataTableColumnMeta | undefined)?.align;
                        return (
                          <TableCell key={cell.id} className={align === 'right' ? 'text-right' : undefined}>
                            <table.FlexRender cell={cell} />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {!isLoading && (hasMore || error) && (
            <div className="flex flex-col items-center gap-2 border-t p-3">
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  Could not load more: {error.message}
                </p>
              )}
              <Button variant="outline" onClick={error ? onRetry : onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : error ? 'Retry' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
