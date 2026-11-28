'use client';

import { format } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, Cell, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { Overview } from '@/features/overview/api';
import { formatMoney } from '@/utils/format';
import { statusBadge } from '@/components/shared/status-badges';

const COMPACT = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });

/** Each colour has a light and a dark value, so both themes keep their contrast. */
const volumeConfig = {
  volume: { label: 'Volume', theme: { light: 'oklch(0.55 0.17 255)', dark: 'oklch(0.72 0.14 255)' } },
} satisfies ChartConfig;

const statusConfig = {
  PENDING: { label: statusBadge('payment', 'PENDING').label, theme: { light: 'oklch(0.55 0.17 240)', dark: 'oklch(0.74 0.13 240)' } },
  SUCCEEDED: { label: statusBadge('payment', 'SUCCEEDED').label, theme: { light: 'oklch(0.55 0.15 160)', dark: 'oklch(0.75 0.15 160)' } },
  CANCELLED: { label: statusBadge('payment', 'CANCELLED').label, theme: { light: 'oklch(0.55 0.02 260)', dark: 'oklch(0.7 0.02 260)' } },
  EXPIRED: { label: statusBadge('payment', 'EXPIRED').label, theme: { light: 'oklch(0.65 0.15 70)', dark: 'oklch(0.78 0.14 75)' } },
} satisfies ChartConfig;

function bucketLabel(iso: string, range: Overview['range']): string {
  return format(new Date(iso), range === '24h' ? 'HH:mm' : 'dd MMM');
}

export function VolumeChart({ overview }: { overview: Overview }) {
  // Plot positions only: every figure shown as text comes from the original decimal string.
  const data = overview.volumeSeries.map((bucket) => ({
    label: bucketLabel(bucket.start, overview.range),
    volume: Number(bucket.volume),
    display: formatMoney(bucket.volume),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Volume over time</CardTitle>
        <CardDescription>Collected volume per {overview.range === '24h' ? 'hour' : 'day'}, in VND</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="img" aria-label={`Volume over time: ${data.length} ${overview.range === '24h' ? 'hourly' : 'daily'} values, total ${formatMoney(overview.volume)}`}>
          <ChartContainer config={volumeConfig} className="h-64 w-full">
            <AreaChart data={data} margin={{ left: 4, right: 8 }} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => COMPACT.format(value)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(_value, _name, item) => <span className="font-mono">{(item.payload as { display: string }).display}</span>}
                  />
                }
              />
              <Area dataKey="volume" type="monotone" stroke="var(--color-volume)" fill="var(--color-volume)" fillOpacity={0.2} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatusChart({ overview }: { overview: Overview }) {
  const data = overview.statusCounts.map(({ status, count }) => ({ status, count, label: statusBadge('payment', status).label }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments by status</CardTitle>
        <CardDescription>{overview.paymentCount} Payments created in the range</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="img" aria-label={`Payments by status chart: ${data.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
          <ChartContainer config={statusConfig} className="h-40 w-full">
            <BarChart data={data} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" radius={4}>
                {data.map((d) => (
                  <Cell key={d.status} fill={`var(--color-${d.status})`} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
        <ChartStyle id="chart-status-legend" config={statusConfig} />
        <ul aria-label="Payments by status" data-chart="chart-status-legend" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {data.map((d) => (
            <li key={d.status} aria-label={`${d.label}: ${d.count}`} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: `var(--color-${d.status})` }} />
              <span className="text-muted-foreground">{d.label}</span>
              <span className="ml-auto font-medium tabular-nums">{d.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
