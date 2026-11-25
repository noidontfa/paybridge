/**
 * The one mapping from a status to its label, tone and icon, used everywhere a
 * status is shown (render it with `<StatusBadge kind value />`).
 *
 * Extension point: later tickets add a kind (Callback status, Payment Event
 * type) by adding one entry to `REGISTRY` below. Unknown values fall back to a
 * neutral badge so a new API status never crashes a screen.
 */
import {
  BanIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  PlusCircleIcon,
  ClockIcon,
  CopyCheckIcon,
  HourglassIcon,
  ScaleIcon,
  SearchCheckIcon,
  TimerOffIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react';
import { humanizeCode } from '@/lib/format';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeSpec {
  label: string;
  tone: BadgeTone;
  icon: LucideIcon;
}

export type BadgeKind = 'payment' | 'transaction' | 'review' | 'event';

const SUCCEEDED: BadgeSpec = { label: 'Succeeded', tone: 'success', icon: CheckCircle2Icon };
const PENDING: BadgeSpec = { label: 'Pending', tone: 'info', icon: HourglassIcon };
const CANCELLED: BadgeSpec = { label: 'Cancelled', tone: 'neutral', icon: BanIcon };
const EXPIRED: BadgeSpec = { label: 'Expired', tone: 'neutral', icon: TimerOffIcon };

const REGISTRY: Record<BadgeKind, Record<string, BadgeSpec>> = {
  payment: {
    PENDING,
    SUCCEEDED,
    CANCELLED,
    EXPIRED,
  },
  transaction: {
    CREATED: { label: 'Created', tone: 'neutral', icon: CircleDashedIcon },
    PENDING,
    SUCCEEDED,
    FAILED: { label: 'Failed', tone: 'danger', icon: XCircleIcon },
    EXPIRED,
    CANCELLED,
    REQUIRES_REVIEW: { label: 'In review', tone: 'warning', icon: SearchCheckIcon },
  },
  review: {
    AMBIGUOUS_PROVIDER_STATUS: { label: 'Ambiguous status', tone: 'warning', icon: CircleDotIcon },
    AMOUNT_MISMATCH: { label: 'Amount mismatch', tone: 'warning', icon: ScaleIcon },
    LATE_SUCCESS_ON_CLOSED_PAYMENT: { label: 'Late success', tone: 'warning', icon: ClockIcon },
    DUPLICATE_SUCCESS: { label: 'Duplicate success', tone: 'warning', icon: CopyCheckIcon },
  },
  /** Payment Event types, toned like the Payment status they announce. */
  event: {
    PaymentCreated: { label: 'Payment created', tone: 'info', icon: PlusCircleIcon },
    PaymentSucceeded: { label: 'Payment succeeded', tone: 'success', icon: CheckCircle2Icon },
    PaymentCancelled: { label: 'Payment cancelled', tone: 'neutral', icon: BanIcon },
    PaymentExpired: { label: 'Payment expired', tone: 'neutral', icon: TimerOffIcon },
    PaymentRequiresReview: { label: 'Payment requires review', tone: 'warning', icon: SearchCheckIcon },
  },
};

export function statusBadge(kind: BadgeKind, value: string): BadgeSpec {
  return REGISTRY[kind][value] ?? { label: humanizeCode(value), tone: 'neutral', icon: CircleDashedIcon };
}

/** Tailwind classes per tone; shared so every badge reads the same in both themes. */
export const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-400',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  neutral: 'bg-muted text-muted-foreground',
};
