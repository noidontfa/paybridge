import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import type { OperatorAttempt } from '@/lib/api/schemas';
import { humanizeCode } from '@/lib/format';
import { ReviewNotice } from './review-notice';
import { StatusHistory } from './status-history';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm">{children}</dd>
    </div>
  );
}

/** Every PaymentTransaction of a Payment, oldest first, with gateway switches called out. */
export function TransactionTimeline({ attempts }: { attempts: OperatorAttempt[] }) {
  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
      <h2 id="timeline-heading" className="text-base font-semibold">
        PaymentTransactions
      </h2>
      {attempts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          No PaymentTransaction has been started for this Payment.
        </p>
      ) : (
        <ol aria-label="PaymentTransactions" className="flex flex-col gap-3">
          {attempts.map((attempt, index) => {
            const previous = attempts[index - 1];
            const switchedFrom = previous && previous.gatewayId !== attempt.gatewayId ? previous.gatewayId : undefined;
            return (
              <li
                key={attempt.id}
                aria-label={`PaymentTransaction ${index + 1}`}
                className="flex flex-col gap-3 rounded-xl border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{attempt.gatewayId}</span>
                  <StatusBadge kind="transaction" value={attempt.status} />
                  {switchedFrom && <span className="text-xs text-muted-foreground">Switched from {switchedFrom}</span>}
                </div>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Attempt Key">
                    <span className="font-mono break-all">{attempt.id}</span>
                    <CopyButton value={attempt.id} label="Attempt Key" />
                  </Field>
                  <Field label="Provider Reference">
                    {attempt.providerRef ? (
                      <>
                        <span className="font-mono break-all">{attempt.providerRef}</span>
                        <CopyButton value={attempt.providerRef} label="Provider Reference" />
                      </>
                    ) : (
                      <span className="text-muted-foreground">None yet</span>
                    )}
                  </Field>
                  <Field label="NextAction">
                    {attempt.nextAction ? humanizeCode(attempt.nextAction.type) : <span className="text-muted-foreground">None</span>}
                  </Field>
                  <Field label="Started">
                    <TimeText iso={attempt.createdAt} />
                  </Field>
                  <Field label="Updated">
                    <TimeText iso={attempt.updatedAt} />
                  </Field>
                </dl>
                <ReviewNotice attempt={attempt} />
                <div className="flex flex-col gap-1">
                  <h3 className="text-xs font-medium text-muted-foreground">Status history</h3>
                  <StatusHistory transitions={attempt.transitions} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
