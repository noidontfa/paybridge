'use client';

import { cn } from '@/utils/cn';
import { OVERVIEW_RANGES, RANGE_LABELS, type OverviewRange } from '@/lib/overview-range';

/** Segmented control for the Overview range; the page keeps the choice in the URL. */
export function RangeSelector({ value, onChange }: { value: OverviewRange; onChange: (range: OverviewRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Range" className="inline-flex rounded-lg border bg-muted p-0.5">
      {OVERVIEW_RANGES.map((range) => {
        const checked = range === value;
        return (
          <button
            key={range}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={RANGE_LABELS[range]}
            onClick={() => onChange(range)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              checked && 'bg-background text-foreground shadow-sm',
            )}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
