import Link from 'next/link';
import { createDataTableColumnHelper, type DataTableColumns } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { PaymentEventSummary } from '@/lib/api/payment-events';

const column = createDataTableColumnHelper<PaymentEventSummary>();

export const eventHref = (event: { id: string }) => `/events/${encodeURIComponent(event.id)}`;
export const paymentHref = (paymentId: string) => `/payments/${encodeURIComponent(paymentId)}`;

/** The outbox is newest first from the server, so no column sorts. */
export const eventColumns: DataTableColumns<PaymentEventSummary> = column.columns([
  column.accessor('type', {
    id: 'type',
    header: 'Type',
    enableSorting: false,
    cell: ({ row }) => (
      <Link href={eventHref(row.original)} className="inline-flex underline-offset-4 hover:underline focus-visible:underline">
        <StatusBadge kind="event" value={row.original.type} />
      </Link>
    ),
  }),
  column.accessor('paymentId', {
    id: 'paymentId',
    header: 'Payment',
    enableSorting: false,
    cell: ({ row }) => (
      <Link
        href={paymentHref(row.original.paymentId)}
        className="block max-w-48 truncate font-mono text-xs underline-offset-4 hover:underline focus-visible:underline"
      >
        {row.original.paymentId}
      </Link>
    ),
  }),
  column.accessor('createdAt', {
    id: 'createdAt',
    header: 'Created',
    enableSorting: false,
    cell: ({ row }) => <TimeText iso={row.original.createdAt} />,
  }),
  column.accessor('publishedAt', {
    id: 'publishedAt',
    header: 'Published',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.publishedAt ? (
        <TimeText iso={row.original.publishedAt} />
      ) : (
        <span className="inline-flex rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          Unpublished
        </span>
      ),
  }),
]);
