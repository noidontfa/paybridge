'use client';

/**
 * Filter controls for the shared data table. Each is a small controlled
 * component; the list screen wires their values to `useTableUrlState`.
 * Native `select` and date inputs keep them keyboard- and phone-friendly.
 */
import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CONTROL =
  'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

export function DataTableToolbar({ children }: { children: ReactNode }) {
  return (
    <div role="search" className="flex flex-wrap items-end gap-2">
      {children}
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

/** A search box that writes to the URL after the Operator pauses typing. */
export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const committed = useRef(value);

  // The URL changed from outside (clear filters, back button): follow it.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = text;
      latest.current.onChange(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="relative w-full sm:w-72">
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="pl-8"
      />
    </div>
  );
}

export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  /** The text of the "no filter" option. */
  allLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={cn(CONTROL, 'max-w-full')}>
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className={cn(CONTROL, 'text-foreground')} />
    </label>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <XIcon aria-hidden />
      Clear filters
    </Button>
  );
}
