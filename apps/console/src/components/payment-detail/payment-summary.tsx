import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { OperatorPayment } from '@/lib/api/schemas';
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
    </section>
  );
}
