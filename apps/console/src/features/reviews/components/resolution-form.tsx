'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { REVIEW_NOTE_MAX_LENGTH } from '@/features/reviews/review-resolution';
import type { OperatorAttempt, OperatorPayment } from '@/features/payments/schemas';
import { useResolveReview } from '@/features/reviews/hooks/review-resolution';
import { useCurrentOperator } from '@/features/auth/hooks/use-operator';
import {
  resolutionFormSchema,
  type ResolutionAction,
  type ResolutionFormInput,
  type ResolutionFormValues,
} from '@/features/reviews/utils/review-resolution-form';
import type { ReviewActions, Verdict } from '@/features/reviews/utils/review-resolution-rules';
import { cn } from '@/utils/cn';

const OPTIONS: { action: ResolutionAction; label: string; verdict: (actions: ReviewActions) => Verdict }[] = [
  { action: 'SUCCEEDED', label: 'Resolve to SUCCEEDED', verdict: (a) => a.succeed },
  { action: 'FAILED', label: 'Resolve to FAILED', verdict: (a) => a.fail },
  { action: 'NOTE', label: 'Add note only', verdict: (a) => a.note },
];

const fieldClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

/**
 * Resolve a Review or add a note to it. `actions` (from the rules module)
 * decides what is offered; the API stays authoritative, and its message shows
 * here when it refuses, with the note kept. A status change asks for
 * confirmation. The Operator is never typed: the BFF sets it.
 */
export function ResolutionForm({
  attempt,
  payment,
  actions,
}: {
  attempt: OperatorAttempt;
  payment: Pick<OperatorPayment, 'id' | 'amount' | 'currency'>;
  actions: ReviewActions;
}) {
  const operator = useCurrentOperator();
  const resolve = useResolveReview(payment.id);
  const schema = useMemo(() => resolutionFormSchema(payment.amount), [payment.amount]);
  const firstAllowed = OPTIONS.find((o) => o.verdict(actions).allowed)?.action ?? 'FAILED';
  const form = useForm<ResolutionFormInput, unknown, ResolutionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { action: firstAllowed, note: '', amount: '' },
  });
  const [confirming, setConfirming] = useState<ResolutionFormValues | null>(null);

  const action = form.watch('action');
  const noteLength = form.watch('note').length;
  const { errors } = form.formState;
  const anyAllowed = !actions.locked && OPTIONS.some((o) => o.verdict(actions).allowed);

  const send = (values: ResolutionFormValues) => {
    resolve.mutate(
      {
        attemptId: attempt.id,
        note: values.note,
        ...(values.action !== 'NOTE' && { status: values.action }),
        ...(values.action === 'SUCCEEDED' && { amount: values.amount }),
      },
      { onSettled: () => setConfirming(null) },
    );
  };

  const onSubmit = (values: ResolutionFormValues) => (values.action === 'NOTE' ? send(values) : setConfirming(values));

  return (
    <form
      aria-label="Resolve Review"
      noValidate
      onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-3 border-t border-amber-500/30 pt-3"
    >
      <fieldset className="flex flex-col gap-1.5" disabled={!anyAllowed}>
        <legend className="mb-1 font-medium">Resolution</legend>
        {OPTIONS.map(({ action: value, label, verdict }) => {
          const result = verdict(actions);
          const hintId = `resolution-${attempt.id}-${value}-hint`;
          return (
            <div key={value} className="flex flex-col gap-0.5">
              <label className={cn('flex items-center gap-2', !result.allowed && 'text-muted-foreground')}>
                <input
                  type="radio"
                  value={value}
                  disabled={!result.allowed}
                  aria-describedby={result.allowed ? undefined : hintId}
                  {...form.register('action')}
                />
                {label}
              </label>
              {!result.allowed && !actions.locked && (
                <p id={hintId} className="pl-6 text-xs text-muted-foreground">
                  {result.reason}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      {action === 'SUCCEEDED' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`amount-${attempt.id}`} className="font-medium">
            Amount collected ({payment.currency})
          </label>
          <Input
            id={`amount-${attempt.id}`}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={`amount-${attempt.id}-hint`}
            {...form.register('amount')}
          />
          <p id={`amount-${attempt.id}-hint`} className={cn('text-xs', errors.amount ? 'text-destructive' : 'text-muted-foreground')}>
            {errors.amount?.message ?? `What the PaymentGateway collected. It must equal the Payment Amount (${payment.amount}).`}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`note-${attempt.id}`} className="font-medium">
          Note
        </label>
        <textarea
          id={`note-${attempt.id}`}
          rows={3}
          disabled={!anyAllowed}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={`note-${attempt.id}-hint`}
          className={fieldClass}
          {...form.register('note')}
        />
        <div id={`note-${attempt.id}-hint`} className="flex justify-between gap-2 text-xs">
          <span className="text-destructive">{errors.note?.message}</span>
          <span
            aria-label="Note length"
            className={cn('ml-auto tabular-nums', noteLength > REVIEW_NOTE_MAX_LENGTH ? 'text-destructive' : 'text-muted-foreground')}
          >
            {noteLength} / {REVIEW_NOTE_MAX_LENGTH}
          </span>
        </div>
      </div>

      {resolve.error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-destructive">
          {resolve.error.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!anyAllowed || resolve.isPending}>
          {action === 'NOTE' ? 'Add note' : 'Resolve Review'}
        </Button>
        <span className="text-xs text-muted-foreground">Recorded as {operator.name}</span>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !resolve.isPending && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve this Review to {confirming?.action}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.action === 'SUCCEEDED'
                ? `The PaymentTransaction and the Payment become SUCCEEDED, with ${confirming.amount} ${payment.currency} collected. `
                : 'The PaymentTransaction becomes FAILED and the Review closes. '}
              This is recorded in the audit log as {operator.name} with your note, and cannot be undone here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button type="button" variant="outline" />} disabled={resolve.isPending}>
              Cancel
            </AlertDialogClose>
            <Button type="button" disabled={resolve.isPending} onClick={() => confirming && send(confirming)}>
              Confirm {confirming?.action}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
