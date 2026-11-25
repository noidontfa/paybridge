import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';

/** Local absolute time with a relative hint ("25 Nov 2026, 14:30:05 (3 days ago)"). */
export function TimeText({ iso }: { iso: string }) {
  return (
    // The date never breaks; the relative hint drops to its own line when the cell is narrow.
    <time dateTime={iso} className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="whitespace-nowrap">{formatAbsoluteTime(iso)}</span>
      <span className="whitespace-nowrap text-muted-foreground">({formatRelativeTime(iso)})</span>
    </time>
  );
}
