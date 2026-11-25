import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';

/** Local absolute time with a relative hint ("25 Nov 2026, 14:30:05 (3 days ago)"). */
export function TimeText({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="whitespace-nowrap">
      {formatAbsoluteTime(iso)} <span className="text-muted-foreground">({formatRelativeTime(iso)})</span>
    </time>
  );
}
