import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusBadge, TONE_CLASSES, type BadgeKind } from '@/lib/status-badges';

/** The one way to show a status: label, tone and icon come from `lib/status-badges`. */
export function StatusBadge({ kind, value, className }: { kind: BadgeKind; value: string; className?: string }) {
  const { label, tone, icon: Icon } = statusBadge(kind, value);
  return (
    <Badge variant="ghost" className={cn(TONE_CLASSES[tone], className)}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
