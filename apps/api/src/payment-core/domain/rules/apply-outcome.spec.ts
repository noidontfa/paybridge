import type { NormalizedOutcome } from '../../port/index.js';
import type { PaymentStatus, AttemptStatus } from '../statuses.js';
import { decideOutcome, type OutcomeSubject } from './apply-outcome.js';

const ATTEMPT = 'attempt-1';

function subject(
  attemptStatus: AttemptStatus,
  options: {
    paymentStatus?: PaymentStatus;
    others?: AttemptStatus[];
    amount?: string;
  } = {},
): OutcomeSubject {
  return {
    payment: {
      status: options.paymentStatus ?? 'PENDING',
      amount: options.amount ?? '150000',
      currency: 'VND',
      attempts: [
        ...(options.others ?? []).map((status, i) => ({
          id: `other-${i}`,
          status,
        })),
        { id: ATTEMPT, status: attemptStatus },
      ],
    },
    attemptId: ATTEMPT,
  };
}

const success = (amount: string | null = '150000'): NormalizedOutcome => ({
  status: 'SUCCEEDED',
  amount,
});
const failure: NormalizedOutcome = { status: 'FAILED', amount: null };
const pending: NormalizedOutcome = { status: 'PENDING', amount: null };
const ambiguous: NormalizedOutcome = {
  status: 'REQUIRES_REVIEW',
  amount: '150000',
};

describe('decideOutcome: an open attempt (CREATED or PENDING)', () => {
  it.each(['CREATED', 'PENDING'] as const)(
    'a success with the Payment amount succeeds the %s attempt',
    (status) => {
      expect(decideOutcome(subject(status), success())).toEqual({
        kind: 'succeed',
      });
    },
  );

  it('compares amounts as decimals, not as strings', () => {
    expect(decideOutcome(subject('PENDING'), success('150000.00'))).toEqual({
      kind: 'succeed',
    });
  });

  it('a success with another amount goes to review (AMOUNT_MISMATCH)', () => {
    expect(decideOutcome(subject('PENDING'), success('149999'))).toEqual({
      kind: 'review',
      reason: 'AMOUNT_MISMATCH',
    });
  });

  it('a success without a reported amount goes to review (AMOUNT_MISMATCH)', () => {
    expect(decideOutcome(subject('PENDING'), success(null))).toEqual({
      kind: 'review',
      reason: 'AMOUNT_MISMATCH',
    });
  });

  it('a success with an unparsable amount goes to review (AMOUNT_MISMATCH)', () => {
    expect(decideOutcome(subject('PENDING'), success('abc'))).toEqual({
      kind: 'review',
      reason: 'AMOUNT_MISMATCH',
    });
  });

  it.each(['CREATED', 'PENDING'] as const)(
    'a clear failure fails the %s attempt',
    (status) => {
      expect(decideOutcome(subject(status), failure)).toEqual({
        kind: 'fail',
      });
    },
  );

  it('an ambiguous result goes to review (AMBIGUOUS_PROVIDER_STATUS)', () => {
    expect(decideOutcome(subject('CREATED'), ambiguous)).toEqual({
      kind: 'review',
      reason: 'AMBIGUOUS_PROVIDER_STATUS',
    });
  });

  it('a pending result leaves a CREATED attempt as it is (no next action to record)', () => {
    expect(decideOutcome(subject('CREATED'), pending)).toEqual({
      kind: 'no-change',
      reason: 'still-pending',
    });
  });

  it('a pending result for a PENDING attempt is a repeat', () => {
    expect(decideOutcome(subject('PENDING'), pending)).toEqual({
      kind: 'no-change',
      reason: 'already-applied',
    });
  });

  it('a success when another attempt already succeeded goes to review (DUPLICATE_SUCCESS)', () => {
    expect(
      decideOutcome(
        subject('PENDING', {
          paymentStatus: 'SUCCEEDED',
          others: ['SUCCEEDED'],
        }),
        success(),
      ),
    ).toEqual({ kind: 'review', reason: 'DUPLICATE_SUCCESS' });
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'a success on a %s Payment goes to review (LATE_SUCCESS_ON_CLOSED_PAYMENT)',
    (paymentStatus) => {
      expect(
        decideOutcome(subject('PENDING', { paymentStatus }), success()),
      ).toEqual({ kind: 'review', reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' });
    },
  );
});

describe('decideOutcome: repeats are no-ops', () => {
  it.each([
    ['SUCCEEDED', success()],
    ['SUCCEEDED', failure],
    ['FAILED', failure],
    ['REQUIRES_REVIEW', ambiguous],
  ] as const)('a %s attempt given %o changes nothing', (status, outcome) => {
    expect(decideOutcome(subject(status), outcome)).toEqual({
      kind: 'no-change',
      reason: 'already-applied',
    });
  });
});

describe('decideOutcome: results this rule leaves to later tickets', () => {
  it.each(['FAILED', 'EXPIRED', 'CANCELLED'] as const)(
    'a success on a %s attempt (late success, ticket 21) changes nothing here',
    (status) => {
      expect(decideOutcome(subject(status), success())).toEqual({
        kind: 'no-change',
        reason: 'not-handled',
      });
    },
  );

  it.each([success(), failure])(
    'a clear result on an attempt in review (review exit, tickets 28/29) changes nothing here',
    (outcome) => {
      expect(decideOutcome(subject('REQUIRES_REVIEW'), outcome)).toEqual({
        kind: 'no-change',
        reason: 'not-handled',
      });
    },
  );

  it.each(['EXPIRED', 'CANCELLED'] as const)(
    'a failure on a %s attempt keeps the closed status',
    (status) => {
      expect(decideOutcome(subject(status), failure)).toEqual({
        kind: 'no-change',
        reason: 'already-closed',
      });
    },
  );
});

it('throws when the attempt is not on the Payment', () => {
  expect(() =>
    decideOutcome({ ...subject('PENDING'), attemptId: 'nope' }, success()),
  ).toThrow(/nope/);
});
