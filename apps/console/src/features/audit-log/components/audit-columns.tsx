import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
import { createDataTableColumnHelper, type DataTableColumns } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { StatusTransitionEntityType } from '@/features/payments/schemas';
import type { AuditEntry } from '@/features/payments/status-transitions';
import { actorText } from '@/lib/actor';

export const ENTITY_TYPE_LABELS: Record<StatusTransitionEntityType, string> = {
  PAYMENT: 'Payment',
  PAYMENT_TRANSACTION: 'PaymentTransaction',
  REFUND: 'Refund',
};

export const auditPaymentHref = (entry: AuditEntry) =>
  entry.paymentId ? `/payments/${encodeURIComponent(entry.paymentId)}` : null;

/** Which status vocabulary a row's from and to statuses use. */
function badgeKind(entityType: StatusTransitionEntityType) {
  return entityType === 'PAYMENT' ? 'payment' : 'transaction';
}

const column = createDataTableColumnHelper<AuditEntry>();

/** The audit log is newest first from the server, so no column sorts. */
export const auditColumns: DataTableColumns<AuditEntry> = column.columns([
  column.accessor('createdAt', {
    id: 'createdAt',
    header: 'Time',
    enableSorting: false,
    cell: ({ row }) => <TimeText iso={row.original.createdAt} />,
  }),
  column.accessor('entityType', {
    id: 'entityType',
    header: 'Entity',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{ENTITY_TYPE_LABELS[row.original.entityType]}</span>
        <span className="block max-w-40 truncate font-mono text-xs">{row.original.entityId}</span>
      </div>
    ),
  }),
  column.display({
    id: 'change',
    header: 'Change',
    enableSorting: false,
    cell: ({ row }) => {
      const { entityType, fromStatus, toStatus } = row.original;
      const kind = badgeKind(entityType);
      return (
        <span className="flex items-center gap-1.5">
          {fromStatus ? <StatusBadge kind={kind} value={fromStatus} /> : <span className="text-muted-foreground">None</span>}
          <ArrowRightIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <StatusBadge kind={kind} value={toStatus} />
        </span>
      );
    },
  }),
  column.accessor('trigger', {
    id: 'trigger',
    header: 'Trigger',
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.trigger}</span>,
  }),
  column.accessor('actor', {
    id: 'actor',
    header: 'Actor',
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs">{actorText(row.original)}</span>,
  }),
  column.accessor('reason', {
    id: 'note',
    header: 'Note',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.reason ? <span className="block max-w-72 whitespace-normal">{row.original.reason}</span> : <span className="text-muted-foreground">-</span>,
  }),
  column.display({
    id: 'payment',
    header: 'Payment',
    enableSorting: false,
    cell: ({ row }) => {
      const href = auditPaymentHref(row.original);
      return href ? (
        <Link href={href} className="block max-w-40 truncate font-mono text-xs underline-offset-4 hover:underline focus-visible:underline">
          {row.original.paymentId}
        </Link>
      ) : null;
    },
  }),
]);
