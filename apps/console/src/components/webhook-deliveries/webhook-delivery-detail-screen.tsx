'use client';

import Link from 'next/link';
import { CopyButton } from '@/components/shared/copy-button';
import { ErrorState, NotFoundState } from '@/components/shared/data-states';
import { StatusBadge } from '@/components/shared/status-badge';
import { TimeText } from '@/components/shared/time-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/services/errors';
import type { WebhookDeliveryAttempt, WebhookDeliveryDetail } from '@/lib/api/webhook-deliveries';
import { useCan } from '@/features/auth/hooks/use-operator';
import { useResendWebhookDelivery, useWebhookDelivery } from '@/lib/queries/webhook-deliveries';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm">{children}</dd>
    </div>
  );
}

/** Who asked for an attempt: a Super Admin is shown as the platform. */
const requester = (attempt: WebhookDeliveryAttempt) =>
  attempt.triggeredBy ? (attempt.triggeredBy.label ?? attempt.triggeredBy.name) : 'Automatic';

function Attempt({ attempt }: { attempt: WebhookDeliveryAttempt }) {
  return (
    <li className="flex flex-col gap-2 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={attempt.succeeded ? 'default' : 'destructive'}>{attempt.succeeded ? 'Succeeded' : 'Failed'}</Badge>
        <TimeText iso={attempt.attemptedAt} />
        <span className="text-muted-foreground">
          HTTP {attempt.httpStatus ?? 'none'} · {attempt.durationMs} ms · {requester(attempt)}
        </span>
      </div>
      {attempt.error && <p className="text-sm text-destructive">{attempt.error}</p>}
      {/* React escapes the text: a receiver's answer is never parsed as HTML. */}
      {attempt.responseBody !== null && attempt.responseBody !== '' && (
        <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
          {attempt.responseBody}
        </pre>
      )}
    </li>
  );
}

function Resend({ delivery }: { delivery: WebhookDeliveryDetail }) {
  const canResend = useCan('webhook-deliveries:resend');
  const resend = useResendWebhookDelivery();
  if (!canResend) return null;
  const latest = resend.data?.history[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={resend.isPending} onClick={() => resend.mutate(delivery.id)}>
        {resend.isPending ? 'Resending…' : 'Resend'}
      </Button>
      {resend.error && (
        <p role="alert" className="text-sm text-destructive">
          {resend.error.message}
        </p>
      )}
      {latest && !resend.isPending && (
        <p role="status" className="text-sm">
          {latest.succeeded ? 'Resent: the endpoint accepted it.' : `Resent, but it failed: ${latest.error ?? 'no answer'}.`}
        </p>
      )}
    </div>
  );
}

export function WebhookDeliveryDetailScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useWebhookDelivery(id);

  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading Webhook delivery" className="flex flex-col gap-6 px-4 pb-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        {isApiError(error) && error.isNotFound ? (
          <NotFoundState title="Webhook delivery not found" description={`No Webhook delivery has the id ${id}. Check the link and try again.`} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <section aria-label="Delivery summary" className="rounded-xl border p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg font-semibold tracking-tight">{data.eventKind}</span>
            <StatusBadge kind="webhookDelivery" value={data.status} />
          </div>
          <Resend delivery={data} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Event id">
            <span className="font-mono break-all">{data.eventId}</span>
            <CopyButton value={data.eventId} label="event id" />
          </Field>
          <Field label="Webhook Endpoint">
            <span className="font-mono break-all">{data.endpoint.url}</span>
          </Field>
          <Field label="Payment">
            {data.paymentId ? (
              <Link href={`/payments/${encodeURIComponent(data.paymentId)}`} className="font-medium underline-offset-4 hover:underline">
                View Payment
              </Link>
            ) : (
              <span className="text-muted-foreground">None (test event)</span>
            )}
          </Field>
          <Field label="Event happened">
            <TimeText iso={data.eventCreatedAt} />
          </Field>
          <Field label="Attempts">
            <span className="tabular-nums">{data.attempts}</span>
          </Field>
        </dl>
      </section>

      <section aria-label="Attempts" className="rounded-xl border p-4">
        <h2 className="mb-2 text-sm font-medium">Attempts, newest first</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attempt yet.</p>
        ) : (
          <ol>
            {data.history.map((attempt) => (
              <Attempt key={attempt.id} attempt={attempt} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
