'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Density, DENSITIES, readDensity, writeDensity } from '@/lib/preferences';
import type { ConsoleEnvironment } from '@/lib/environment';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
};

export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
}

/** Applies the remembered table density on every page. */
export function DensityEffect() {
  useEffect(() => applyDensity(readDensity()), []);
  return null;
}

function RadioChoice<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsPanel({ environment }: { environment: ConsoleEnvironment }) {
  const { theme, setTheme } = useTheme();
  const [density, setDensity] = useState<Density>('comfortable');

  // Storage is read after mount so server and client markup agree.
  useEffect(() => setDensity(readDensity()), []);

  function chooseDensity(next: Density) {
    setDensity(next);
    writeDensity(next);
    applyDensity(next);
  }

  const rows: [string, string][] = [
    ['API base URL', environment.apiBaseUrl],
    ['Mock mode', environment.mockMode ? 'On' : 'Off'],
    ['Build version', environment.version],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>Remembered in this browser only.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <RadioChoice
            legend="Theme"
            name="theme"
            options={THEMES}
            value={theme as (typeof THEMES)[number]['value'] | undefined}
            onChange={setTheme}
          />
          <RadioChoice
            legend="Table density"
            name="density"
            options={DENSITIES.map((d) => ({ value: d, label: DENSITY_LABELS[d] }))}
            value={density}
            onChange={chooseDensity}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
          <CardDescription>Provided by the Console server. Read-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm">
            {rows.map(([term, detail]) => (
              <div key={term} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="font-mono break-all">{detail}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
