import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { CheckoutOrigin, OperatorPayment } from '@/lib/api/schemas';
import { formatMoney } from '@/lib/format';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm">{children}</dd>
    </div>
  );
}

export function PaymentSummary({ payment }: { payment: OperatorPayment }) {
  return (
    <section aria-label="Payment summary" className="rounded-xl border p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold tracking-tight">{formatMoney(payment.amount)}</span>
        <StatusBadge kind="payment" value={payment.status} />
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Payment id">
          <span className="font-mono break-all">{payment.id}</span>
          <CopyButton value={payment.id} label="Payment id" />
        </Field>
        <Field label="Upstream Reference">
          <span className="font-mono break-all">{payment.upstreamReference}</span>
          <CopyButton value={payment.upstreamReference} label="Upstream Reference" />
        </Field>
        <Field label="Payment Expiry">
          <TimeText iso={payment.expiresAt} />
        </Field>
        <Field label="Created">
          <TimeText iso={payment.createdAt} />
        </Field>
        <Field label="Updated">
          <TimeText iso={payment.updatedAt} />
        </Field>
      </dl>
      {payment.checkoutOrigin && <CheckoutOriginFields origin={payment.checkoutOrigin} />}
    </section>
  );
}

/** Where a Payment from the Embedded Checkout came from: its Pricing Plan (name at purchase) and Customer. */
function CheckoutOriginFields({ origin }: { origin: CheckoutOrigin }) {
  return (
    <div role="group" aria-label="Embedded Checkout" className="mt-4 border-t pt-4">
      <h3 className="mb-3 text-sm font-medium">Embedded Checkout</h3>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Pricing Plan (name at purchase)">
          <Link href={`/pricing-plans/${origin.pricingPlanId}`} className="underline-offset-4 hover:underline">
            {origin.pricingPlanName}
          </Link>
        </Field>
        <Field label="Customer Reference">
          {origin.customerReference ? (
            <>
              <span className="font-mono break-all">{origin.customerReference}</span>
              <CopyButton value={origin.customerReference} label="Customer Reference" />
            </>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>
        <Field label="Customer email">
          {origin.customerEmail ? <span className="break-all">{origin.customerEmail}</span> : <span className="text-muted-foreground">None</span>}
        </Field>
      </dl>
    </div>
  );
}
