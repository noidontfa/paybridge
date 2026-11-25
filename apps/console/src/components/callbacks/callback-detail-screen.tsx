'use client';

import Link from 'next/link';
import { ErrorState, NotFoundState } from '@/components/data-states';
import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api/errors';
import type { CallbackDetail } from '@/lib/api/callbacks';
import { useCallback } from '@/lib/queries/callbacks';

/** JSON objects and arrays are pretty-printed; anything else is shown exactly as received. */
export function formatBody(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return JSON.stringify(parsed, null, 2);
  } catch {
    // not JSON
  }
  return raw;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm">{children}</dd>
    </div>
  );
}

function Pairs({ label, pairs, empty }: { label: string; pairs: Record<string, string>; empty: string }) {
  const entries = Object.entries(pairs);
  return (
    <section aria-label={label} className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-medium">{label}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,max-content)_1fr]">
          {entries.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
              <dd className="font-mono text-xs break-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function PaymentLink({ callback }: { callback: CallbackDetail }) {
  if (callback.paymentId) {
    return (
      <Link href={`/payments/${encodeURIComponent(callback.paymentId)}`} className="text-sm font-medium underline-offset-4 hover:underline">
        View Payment
      </Link>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">
      {callback.attemptKey ? 'The Attempt Key matches no PaymentTransaction.' : 'This Callback names no Attempt Key.'}
    </span>
  );
}

export function CallbackDetailScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useCallback(id);

  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading Callback" className="flex flex-col gap-6 px-4 pb-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        {isApiError(error) && error.isNotFound ? (
          <NotFoundState title="Callback not found" description={`No Callback has the id ${id}. Check the link and try again.`} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <section aria-label="Callback summary" className="rounded-xl border p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">{data.gatewayId}</span>
          <StatusBadge kind="callback" value={data.status} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Callback id">
            <span className="font-mono break-all">{data.id}</span>
            <CopyButton value={data.id} label="Callback id" />
          </Field>
          <Field label="Provider event id">
            {data.providerEventId ? (
              <>
                <span className="font-mono break-all">{data.providerEventId}</span>
                <CopyButton value={data.providerEventId} label="provider event id" />
              </>
            ) : (
              <span className="text-muted-foreground">No event id</span>
            )}
          </Field>
          <Field label="Attempt Key">
            {data.attemptKey ? (
              <>
                <span className="font-mono break-all">{data.attemptKey}</span>
                <CopyButton value={data.attemptKey} label="Attempt Key" />
              </>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Field>
          <Field label="Delivery attempts">
            <span className="tabular-nums">{data.attempts}</span>
          </Field>
          <Field label="Received">
            <TimeText iso={data.receivedAt} />
          </Field>
          <Field label="Processed">{data.processedAt ? <TimeText iso={data.processedAt} /> : <span className="text-muted-foreground">Not processed</span>}</Field>
          <Field label="Payment">
            <PaymentLink callback={data} />
          </Field>
        </dl>
      </section>

      {data.lastError && (
        <section aria-label="Last error" className="rounded-xl border border-destructive/30 p-4">
          <h2 className="mb-2 text-sm font-medium text-destructive">Last error</h2>
          <p className="font-mono text-sm break-words whitespace-pre-wrap">{data.lastError}</p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Pairs label="Headers" pairs={data.headers} empty="No headers were stored." />
        <Pairs label="Query" pairs={data.query} empty="The request had no query string." />
      </div>

      <section aria-label="Raw body" className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Raw body</h2>
          {data.rawBody !== '' && <CopyButton value={data.rawBody} label="raw body" />}
        </div>
        {/* React escapes the text: a body is never parsed as HTML. */}
        {data.rawBody === '' ? (
          <p className="text-sm text-muted-foreground">The request had no body.</p>
        ) : (
          <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{formatBody(data.rawBody)}</pre>
        )}
      </section>
    </div>
  );
}
