import Link from 'next/link';
import { createDataTableColumnHelper, type DataTableColumns } from '@/components/shared/data-table/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { TimeText } from '@/components/shared/time-text';
import type { WebhookDeliveryListItem } from '@/lib/api/webhook-deliveries';

const column = createDataTableColumnHelper<WebhookDeliveryListItem>();

export const webhookDeliveryHref = (delivery: { id: string }) => `/webhooks/deliveries/${encodeURIComponent(delivery.id)}`;

/** Deliveries always come newest first, so no column sorts. */
export const webhookDeliveryColumns: DataTableColumns<WebhookDeliveryListItem> = column.columns([
  column.accessor('eventKind', {
    id: 'eventKind',
    header: 'Event',
    enableSorting: false,
    cell: ({ row }) => (
      <Link href={webhookDeliveryHref(row.original)} className="font-mono text-xs font-medium underline-offset-4 hover:underline focus-visible:underline">
        {row.original.eventKind}
      </Link>
    ),
  }),
  column.accessor((row) => row.endpoint.url, {
    id: 'endpoint',
    header: 'Webhook Endpoint',
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs break-all">{row.original.endpoint.url}</span>,
  }),
  column.accessor('paymentId', {
    id: 'paymentId',
    header: 'Payment',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.paymentId ? (
        <Link href={`/payments/${encodeURIComponent(row.original.paymentId)}`} className="font-mono text-xs break-all underline-offset-4 hover:underline">
          {row.original.paymentId}
        </Link>
      ) : (
        <span className="text-muted-foreground">Test event</span>
      ),
  }),
  column.accessor('status', {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => <StatusBadge kind="webhookDelivery" value={row.original.status} />,
  }),
  column.accessor('attempts', {
    id: 'attempts',
    header: 'Attempts',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.attempts}</span>,
  }),
  column.accessor('lastAttemptAt', {
    id: 'lastAttemptAt',
    header: 'Last attempt',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.lastAttemptAt ? <TimeText iso={row.original.lastAttemptAt} /> : <span className="text-muted-foreground">Not yet</span>,
  }),
  column.accessor('lastHttpStatus', {
    id: 'lastHttpStatus',
    header: 'HTTP status',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.lastHttpStatus !== null ? (
        <span className="tabular-nums">{row.original.lastHttpStatus}</span>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  }),
]);
