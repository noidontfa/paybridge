import { createDataTableColumnHelper, type DataTableColumns } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/status-badge';
import type { ReviewItem } from '@/features/reviews/api';
import { formatMoney, formatOpenFor } from '@/utils/format';

const column = createDataTableColumnHelper<ReviewItem>();

/**
 * The reason cell is a button: it is the keyboard path to the sheet (a click
 * anywhere else on the row opens it too). `reviewOpenedAt` is the one sortable
 * column; the id matches the endpoint's `sort`.
 */
export function reviewColumns(onOpen: (review: ReviewItem) => void): DataTableColumns<ReviewItem> {
  return column.columns([
    column.display({
      id: 'reason',
      header: 'Reason',
      enableSorting: false,
      cell: ({ row }) => (
        <button
          type="button"
          aria-label={`Review ${row.original.payment.upstreamReference}`}
          onClick={() => onOpen(row.original)}
          className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <StatusBadge kind="review" value={row.original.reason} />
        </button>
      ),
    }),
    column.display({
      id: 'payment',
      header: 'Payment',
      enableSorting: false,
      cell: ({ row }) => <span className="font-medium">{row.original.payment.upstreamReference}</span>,
    }),
    column.accessor('gatewayId', {
      id: 'gatewayId',
      header: 'Gateway',
      enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.gatewayId}</span>,
    }),
    column.display({
      id: 'amount',
      header: 'Payment Amount',
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.payment.amount)}</span>,
    }),
    column.display({
      id: 'providerReportedAmount',
      header: 'Provider reported',
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.providerReportedAmount ? (
          <span className="tabular-nums">{formatMoney(row.original.providerReportedAmount)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    }),
    column.accessor('reviewOpenedAt', {
      id: 'reviewOpenedAt',
      header: 'Open for',
      cell: ({ row }) => (
        <time dateTime={row.original.reviewOpenedAt} className="whitespace-nowrap">
          {formatOpenFor(row.original.reviewOpenedAt)}
        </time>
      ),
    }),
    column.accessor('refundRequired', {
      id: 'refundRequired',
      header: 'Refund required',
      enableSorting: false,
      cell: ({ row }) => (row.original.refundRequired ? 'Yes' : 'No'),
    }),
  ]);
}
