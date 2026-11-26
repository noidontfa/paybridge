/**
 * The Review resolution form's schema (React Hook Form + Zod). It checks what
 * the form can know; the API stays authoritative and its rejection message is
 * shown in the form.
 */
import { z } from 'zod';
import { REVIEW_NOTE_MAX_LENGTH } from '@/lib/api/review-resolution';
import { compareDecimal } from '@/lib/decimal';

export const RESOLUTION_ACTIONS = ['SUCCEEDED', 'FAILED', 'NOTE'] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

/** `paymentAmount` is a decimal string; the amount is compared as decimals, never as floats. */
export function resolutionFormSchema(paymentAmount: string) {
  return z
    .object({
      action: z.enum(RESOLUTION_ACTIONS),
      note: z
        .string()
        .trim()
        .min(1, 'Enter a note explaining the decision.')
        .max(
          REVIEW_NOTE_MAX_LENGTH,
          `The note can be at most ${REVIEW_NOTE_MAX_LENGTH} characters.`,
        ),
      amount: z.string().trim(),
    })
    .superRefine((value, ctx) => {
      if (value.action !== 'SUCCEEDED') return;
      const issue = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['amount'], message });
      if (value.amount === '')
        return issue('Enter the amount the PaymentGateway collected.');
      if (!/^\d+(\.\d+)?$/.test(value.amount))
        return issue('Enter a number, for example 100000.');
      if (compareDecimal(value.amount, paymentAmount) !== 0) {
        issue(`The amount must equal the Payment Amount (${paymentAmount}).`);
      }
    });
}

export type ResolutionFormInput = z.input<
  ReturnType<typeof resolutionFormSchema>
>;
export type ResolutionFormValues = z.output<
  ReturnType<typeof resolutionFormSchema>
>;
