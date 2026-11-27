import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Overview } from '@/lib/api/overview-schema';
import { formatMoney, formatRelativeTime } from '@/utils/format';

export function formatRate(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`;
}

function Figure({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <Card size="sm" className="h-full">
        <CardHeader>
          <CardDescription>{title}</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{children}</CardTitle>
        </CardHeader>
        {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
      </Card>
    </section>
  );
}

/** The four headline figures. */
export function Figures({ overview }: { overview: Overview }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Figure title="Volume collected" hint="Succeeded Payments, in VND">
        {formatMoney(overview.volume)}
      </Figure>
      <Figure title="Payments" hint="Created in the range">
        {overview.paymentCount}
      </Figure>
      <Figure title="Success rate" hint="Succeeded over closed Payments">
        {formatRate(overview.successRate)}
      </Figure>
      <Figure title="Open Reviews">
        <span>{overview.openReviewCount}</span>
        <Link href="/exceptions" className="mt-1 flex items-center gap-1 text-sm font-normal text-primary underline-offset-4 hover:underline">
          Go to Exceptions <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      </Figure>
    </div>
  );
}

export function GatewayBreakdown({ gateways }: { gateways: Overview['gateways'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>PaymentGateways</CardTitle>
        <CardDescription>By the gateway of each Payment&apos;s latest PaymentTransaction</CardDescription>
      </CardHeader>
      <CardContent>
        {gateways.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PaymentTransactions started in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Payments by PaymentGateway" className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Gateway</th>
                  <th className="py-2 pr-4 font-medium">Payments</th>
                  <th className="py-2 pr-4 font-medium">Volume</th>
                  <th className="py-2 font-medium">Success rate</th>
                </tr>
              </thead>
              <tbody>
                {gateways.map((gateway) => (
                  <tr key={gateway.gatewayId} className="border-t">
                    <td className="py-2 pr-4 font-mono">{gateway.gatewayId}</td>
                    <td className="py-2 pr-4 tabular-nums">{gateway.count}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatMoney(gateway.volume)}</td>
                    <td className="py-2 tabular-nums">{formatRate(gateway.successRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentPayments({ payments }: { payments: Overview['recentPayments'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Payments</CardTitle>
        <CardDescription>The latest Payments created in the range</CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-label="Recent Payments" className="divide-y">
          {payments.map((payment) => (
            <li key={payment.id}>
              <Link
                href={`/payments/${encodeURIComponent(payment.id)}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-1 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-mono">{payment.upstreamReference}</span>
                <span className="tabular-nums">{formatMoney(payment.amount)}</span>
                <StatusBadge kind="payment" value={payment.status} />
                <span className="text-muted-foreground">{payment.gatewayId ?? 'No gateway yet'}</span>
                <time dateTime={payment.createdAt} className="ml-auto text-muted-foreground">
                  {formatRelativeTime(payment.createdAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
