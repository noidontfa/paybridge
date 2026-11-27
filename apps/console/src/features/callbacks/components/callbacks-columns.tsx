import Link from 'next/link';
import { createDataTableColumnHelper, type DataTableColumns } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { CallbackListItem } from '@/features/callbacks/api';

const column = createDataTableColumnHelper<CallbackListItem>();

export const callbackHref = (callback: { id: string }) => `/callbacks/${encodeURIComponent(callback.id)}`;

/** Callbacks always arrive newest first, so no column sorts. */
export const callbackColumns: DataTableColumns<CallbackListItem> = column.columns([
  column.accessor('gatewayId', {
    id: 'gatewayId',
    header: 'Gateway',
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.gatewayId}</span>,
  }),
  column.accessor('providerEventId', {
    id: 'providerEventId',
    header: 'Provider event id',
    enableSorting: false,
    cell: ({ row }) => (
      <Link href={callbackHref(row.original)} className="font-mono text-xs font-medium underline-offset-4 hover:underline focus-visible:underline">
        {row.original.providerEventId ?? <span className="font-sans text-muted-foreground">No event id</span>}
      </Link>
    ),
  }),
  column.accessor('attemptKey', {
    id: 'attemptKey',
    header: 'Attempt Key',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.attemptKey ? (
        <span className="font-mono text-xs break-all">{row.original.attemptKey}</span>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  }),
  column.accessor('status', {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => <StatusBadge kind="callback" value={row.original.status} />,
  }),
  column.accessor('attempts', {
    id: 'attempts',
    header: 'Attempts',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.attempts}</span>,
  }),
  column.accessor('receivedAt', {
    id: 'receivedAt',
    header: 'Received',
    enableSorting: false,
    cell: ({ row }) => <TimeText iso={row.original.receivedAt} />,
  }),
  column.accessor('processedAt', {
    id: 'processedAt',
    header: 'Processed',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.processedAt ? <TimeText iso={row.original.processedAt} /> : <span className="text-muted-foreground">Not processed</span>,
  }),
]);
