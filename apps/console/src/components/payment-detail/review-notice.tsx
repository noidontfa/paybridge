import { StatusBadge } from '@/components/status-badge';
import type { OperatorAttempt } from '@/lib/api/schemas';
import { formatOpenFor } from '@/lib/format';

/**
 * A PaymentTransaction in Review: reason, how long it has been open, and
 * whether a refund is required. Read-only for now; ticket 06 puts the
 * resolution actions in this component, so the Exceptions sheet and this
 * timeline share one Review panel.
 */
export function ReviewNotice({ attempt }: { attempt: OperatorAttempt }) {
  if (!attempt.reviewReason) return null;
  return (
    <div role="group" aria-label="Review" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-amber-500/10 p-3 text-sm">
      <StatusBadge kind="review" value={attempt.reviewReason} />
      {attempt.reviewOpenedAt && <span>Open for {formatOpenFor(attempt.reviewOpenedAt)}</span>}
      <span>Refund required: {attempt.refundRequired ? 'Yes' : 'No'}</span>
    </div>
  );
}
