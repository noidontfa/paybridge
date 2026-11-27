import Link from 'next/link';
import { createDataTableColumnHelper, type DataTableColumns } from '@/components/shared/data-table/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { TimeText } from '@/components/shared/time-text';
import type { PaymentListItem } from '@/features/payments/api';
import { formatMoney } from '@/utils/format';

const column = createDataTableColumnHelper<PaymentListItem>();

export const paymentHref = (payment: { id: string }) => `/payments/${encodeURIComponent(payment.id)}`;

/** Created time and Amount are sortable (server-side); the ids match the endpoint's `sort`. */
export const paymentColumns: DataTableColumns<PaymentListItem> = column.columns([
  column.accessor('upstreamReference', {
    id: 'upstreamReference',
    header: 'Upstream Reference',
    enableSorting: false,
    cell: ({ row }) => (
      <Link href={paymentHref(row.original)} className="font-medium underline-offset-4 hover:underline focus-visible:underline">
        {row.original.upstreamReference}
      </Link>
    ),
  }),
  column.accessor('amount', {
    id: 'amount',
    header: 'Amount',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.amount)}</span>,
  }),
  column.accessor('status', {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => <StatusBadge kind="payment" value={row.original.status} />,
  }),
  column.display({
    id: 'gateway',
    header: 'Gateway',
    enableSorting: false,
    cell: ({ row }) => {
      const latest = row.original.latestTransaction;
      if (!latest) return <span className="text-muted-foreground">None yet</span>;
      return (
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs">{latest.gatewayId}</span>
          <StatusBadge kind="transaction" value={latest.status} />
        </span>
      );
    },
  }),
  column.accessor('createdAt', {
    id: 'createdAt',
    header: 'Created',
    cell: ({ row }) => <TimeText iso={row.original.createdAt} />,
  }),
  column.accessor('expiresAt', {
    id: 'expiresAt',
    header: 'Expires',
    enableSorting: false,
    cell: ({ row }) => <TimeText iso={row.original.expiresAt} />,
  }),
]);
