import { StatusBadge } from '@/components/status-badge';
import type { OperatorAttempt } from '@/lib/api/schemas';
import { REVIEW_RESOLVABLE_AFTER_HOURS } from '@/lib/api/reviews';
import { formatAbsoluteTime, formatMoney, formatOpenFor } from '@/lib/format';

const HOUR = 3_600_000;

/** When a Review opened at `openedAt` may be resolved, or null once that time has passed. */
export function resolvableFrom(openedAt: string, now: Date = new Date()): Date | null {
  const at = new Date(Date.parse(openedAt) + REVIEW_RESOLVABLE_AFTER_HOURS * HOUR);
  return at.getTime() > now.getTime() ? at : null;
}

/**
 * The Review panel: a PaymentTransaction's review reason, how long the Review
 * has been open, whether a refund is required, the provider-reported amount
 * when known, and (while the Review is under 72 hours old) when it becomes
 * resolvable. One component for the Exceptions sheet and the Payment detail
 * timeline. Read-only for now; ticket 06 adds the resolution actions here.
 */
export function ReviewPanel({ attempt }: { attempt: OperatorAttempt }) {
  if (!attempt.reviewReason) return null;
  const open = attempt.status === 'REQUIRES_REVIEW';
  const resolvable = open && attempt.reviewOpenedAt ? resolvableFrom(attempt.reviewOpenedAt) : null;
  return (
    <div role="group" aria-label="Review" className="flex flex-col gap-2 rounded-lg bg-amber-500/10 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusBadge kind="review" value={attempt.reviewReason} />
        {attempt.reviewOpenedAt && <span>{open ? 'Open for' : 'Opened'} {formatOpenFor(attempt.reviewOpenedAt)}{open ? '' : ' ago'}</span>}
        <span>Refund required: {attempt.refundRequired ? 'Yes' : 'No'}</span>
        {attempt.providerReportedAmount && <span>Provider reported {formatMoney(attempt.providerReportedAmount)}</span>}
      </div>
      {resolvable && (
        <p className="text-muted-foreground">
          Resolvable from <time dateTime={resolvable.toISOString()}>{formatAbsoluteTime(resolvable.toISOString())}</time>. Automatic
          re-query runs first.
        </p>
      )}
    </div>
  );
}
