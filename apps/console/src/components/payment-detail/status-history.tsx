import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { BadgeKind } from '@/components/status-badges';
import type { StatusTransition } from '@/lib/api/schemas';
import { actorText } from '@/lib/actor';

const KIND_BY_ENTITY: Record<StatusTransition['entityType'], BadgeKind> = {
  PAYMENT: 'payment',
  PAYMENT_TRANSACTION: 'transaction',
  REFUND: 'transaction',
};

/** A status trail from the audit log: from, to, trigger, actor, note and time. Oldest first. */
export function StatusHistory({ transitions }: { transitions: StatusTransition[] }) {
  if (transitions.length === 0) {
    return <p className="text-sm text-muted-foreground">No status changes recorded.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Status history</caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-4 font-normal">From</th>
            <th scope="col" className="py-1 pr-4 font-normal">To</th>
            <th scope="col" className="py-1 pr-4 font-normal">Trigger</th>
            <th scope="col" className="py-1 pr-4 font-normal">Actor</th>
            <th scope="col" className="py-1 pr-4 font-normal">Note</th>
            <th scope="col" className="py-1 font-normal">Time</th>
          </tr>
        </thead>
        <tbody>
          {transitions.map((step) => (
            <tr key={step.id} className="border-t">
              <td className="py-1.5 pr-4">
                {step.fromStatus ? <StatusBadge kind={KIND_BY_ENTITY[step.entityType]} value={step.fromStatus} /> : <span className="text-muted-foreground">Created</span>}
              </td>
              <td className="py-1.5 pr-4">
                <StatusBadge kind={KIND_BY_ENTITY[step.entityType]} value={step.toStatus} />
              </td>
              <td className="py-1.5 pr-4 font-mono text-xs">{step.trigger}</td>
              <td className="py-1.5 pr-4">{actorText(step)}</td>
              <td className="py-1.5 pr-4">{step.reason ?? <span className="text-muted-foreground">-</span>}</td>
              <td className="py-1.5">
                <TimeText iso={step.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
