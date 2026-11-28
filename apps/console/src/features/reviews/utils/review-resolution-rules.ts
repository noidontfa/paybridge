/**
 * Which resolution actions an Operator may take on a Review, and why the others
 * are not offered. A pure module: it shapes the form, while the API stays
 * authoritative (Payment Core spec, "Review exit"):
 *
 * - a status resolution waits until the Review has been open for 72 hours (the
 *   notes on late-success and duplicate-success Reviews are never locked: Core
 *   accepts them at any time);
 * - `AMBIGUOUS_PROVIDER_STATUS`: SUCCEEDED (only while the Payment is `PENDING`,
 *   with the collected amount equal to the Payment Amount) or FAILED;
 * - `AMOUNT_MISMATCH`: FAILED only;
 * - `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS`: add a note only.
 */
import { REVIEW_RESOLVABLE_AFTER_HOURS } from '@/features/reviews/api';
import type { AttemptStatus, PaymentStatus, ReviewReason } from '@/features/payments/schemas';

const HOUR = 3_600_000;

export interface ReviewFacts {
  reason: ReviewReason;
  /** Status of the PaymentTransaction in Review. */
  attemptStatus: AttemptStatus;
  reviewOpenedAt?: string;
  paymentStatus: PaymentStatus;
}

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export interface ReviewActions {
  /** The PaymentTransaction is still in Review. */
  open: boolean;
  /** Open for less than 72 hours (or opened time unknown), on a Review that takes a status: nothing can be done yet. */
  locked: boolean;
  succeed: Verdict;
  fail: Verdict;
  note: Verdict;
}

const ALLOWED: Verdict = { allowed: true };
const no = (reason: string): Verdict => ({ allowed: false, reason });

export function reviewActions(facts: ReviewFacts, now: Date = new Date()): ReviewActions {
  const open = facts.attemptStatus === 'REQUIRES_REVIEW';
  const noteOnly = facts.reason === 'LATE_SUCCESS_ON_CLOSED_PAYMENT' || facts.reason === 'DUPLICATE_SUCCESS';
  const locked =
    !noteOnly &&
    (!facts.reviewOpenedAt || Date.parse(facts.reviewOpenedAt) + REVIEW_RESOLVABLE_AFTER_HOURS * HOUR > now.getTime());

  if (!open) {
    const done = no('This Review has already been resolved.');
    return { open, locked, succeed: done, fail: done, note: done };
  }
  if (locked) {
    const wait = no(`A Review can be resolved after it has been open for ${REVIEW_RESOLVABLE_AFTER_HOURS} hours.`);
    return { open, locked, succeed: wait, fail: wait, note: wait };
  }

  const { reason } = facts;
  const resolvesStatus = reason === 'AMBIGUOUS_PROVIDER_STATUS' || reason === 'AMOUNT_MISMATCH';
  let succeed: Verdict;
  if (reason === 'AMOUNT_MISMATCH') {
    succeed = no('An amount mismatch cannot be marked succeeded: the collected amount differs from the Payment Amount.');
  } else if (reason !== 'AMBIGUOUS_PROVIDER_STATUS') {
    succeed = no('This kind of Review only takes a note.');
  } else if (facts.paymentStatus !== 'PENDING') {
    succeed = no(`SUCCEEDED needs the Payment to be PENDING; it is ${facts.paymentStatus}.`);
  } else {
    succeed = ALLOWED;
  }
  const fail: Verdict = resolvesStatus ? ALLOWED : no('This kind of Review only takes a note.');
  const note: Verdict = resolvesStatus ? no('Resolve this Review to a status instead; the note is recorded with it.') : ALLOWED;
  return { open, locked, succeed, fail, note };
}
