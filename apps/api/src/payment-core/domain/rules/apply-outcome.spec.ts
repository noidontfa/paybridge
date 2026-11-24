import type { NormalizedOutcome } from '../../port/index.js';
import type {
  AttemptStatus,
  PaymentStatus,
  ReviewReason,
} from '../statuses.js';
import { decideOutcome, type OutcomeSubject } from './apply-outcome.js';

const ATTEMPT = 'attempt-1';

function subject(
  attemptStatus: AttemptStatus,
  options: {
    paymentStatus?: PaymentStatus;
    others?: AttemptStatus[];
    amount?: string;
    reviewReason?: ReviewReason;
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
        {
          id: ATTEMPT,
          status: attemptStatus,
          reviewReason: options.reviewReason ?? null,
        },
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

describe('decideOutcome: late success on a closed attempt', () => {
  const closed = ['FAILED', 'EXPIRED', 'CANCELLED'] as const;

  it.each(closed)(
    'a %s attempt on a PENDING Payment with no success and the right amount is promoted',
    (status) => {
      expect(decideOutcome(subject(status), success())).toEqual({
        kind: 'succeed',
      });
      expect(
        decideOutcome(subject(status, { others: ['PENDING'] }), success()),
      ).toEqual({ kind: 'succeed' });
    },
  );

  it.each(closed)(
    'a %s attempt succeeding with another amount goes to review (AMOUNT_MISMATCH)',
    (status) => {
      expect(decideOutcome(subject(status), success('1'))).toEqual({
        kind: 'review',
        reason: 'AMOUNT_MISMATCH',
      });
      expect(decideOutcome(subject(status), success(null))).toEqual({
        kind: 'review',
        reason: 'AMOUNT_MISMATCH',
      });
    },
  );

  it.each(closed)(
    'a %s attempt on a PENDING Payment with another succeeded attempt goes to review (DUPLICATE_SUCCESS)',
    (status) => {
      expect(
        decideOutcome(subject(status, { others: ['SUCCEEDED'] }), success()),
      ).toEqual({ kind: 'review', reason: 'DUPLICATE_SUCCESS' });
    },
  );

  it.each(
    closed.flatMap((a) =>
      (['EXPIRED', 'CANCELLED'] as const).map((p) => [a, p] as const),
    ),
  )(
    'a %s attempt on an %s Payment goes to review (LATE_SUCCESS_ON_CLOSED_PAYMENT), never promoted',
    (status, paymentStatus) => {
      expect(
        decideOutcome(subject(status, { paymentStatus }), success()),
      ).toEqual({ kind: 'review', reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' });
      // The amount does not matter on a closed Payment.
      expect(
        decideOutcome(subject(status, { paymentStatus }), success('1')),
      ).toEqual({ kind: 'review', reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' });
    },
  );

  it.each(closed)(
    'a %s attempt on a SUCCEEDED Payment goes to review (DUPLICATE_SUCCESS)',
    (status) => {
      expect(
        decideOutcome(
          subject(status, {
            paymentStatus: 'SUCCEEDED',
            others: ['SUCCEEDED'],
          }),
          success(),
        ),
      ).toEqual({ kind: 'review', reason: 'DUPLICATE_SUCCESS' });
    },
  );

  it('an attempt cancelled by a late promotion that then succeeds goes to review', () => {
    expect(
      decideOutcome(
        subject('CANCELLED', {
          paymentStatus: 'SUCCEEDED',
          others: ['SUCCEEDED'],
        }),
        success(),
      ),
    ).toEqual({ kind: 'review', reason: 'DUPLICATE_SUCCESS' });
  });

  it('a repeat of a late success already in review changes nothing', () => {
    expect(decideOutcome(subject('REQUIRES_REVIEW'), success())).toEqual({
      kind: 'no-change',
      reason: 'not-handled',
    });
  });
});

describe('decideOutcome: review exit (ticket 28)', () => {
  const review = (
    reviewReason: ReviewReason,
    options: { paymentStatus?: PaymentStatus; others?: AttemptStatus[] } = {},
  ) => subject('REQUIRES_REVIEW', { reviewReason, ...options });

  it.each(['AMBIGUOUS_PROVIDER_STATUS', 'AMOUNT_MISMATCH'] as const)(
    'a clear success with the right amount promotes a %s review',
    (reason) => {
      expect(decideOutcome(review(reason), success())).toEqual({
        kind: 'succeed',
      });
    },
  );

  it.each(['AMBIGUOUS_PROVIDER_STATUS', 'AMOUNT_MISMATCH'] as const)(
    'a clear failure fails a %s review',
    (reason) => {
      expect(decideOutcome(review(reason), failure)).toEqual({ kind: 'fail' });
    },
  );

  it.each([pending, success('1'), success(null)])(
    'an unclear or still-mismatched answer leaves the review open',
    (outcome) => {
      expect(decideOutcome(review('AMOUNT_MISMATCH'), outcome)).toEqual({
        kind: 'no-change',
        reason: 'still-in-review',
      });
    },
  );

  it('an unclear answer on a review leaves it as it is', () => {
    expect(decideOutcome(review('AMOUNT_MISMATCH'), ambiguous)).toEqual({
      kind: 'no-change',
      reason: 'already-applied',
    });
  });

  it('a success that is unsafe now (Payment closed) leaves the review open', () => {
    expect(
      decideOutcome(
        review('AMBIGUOUS_PROVIDER_STATUS', { paymentStatus: 'CANCELLED' }),
        success(),
      ),
    ).toEqual({ kind: 'no-change', reason: 'still-in-review' });
  });

  it('a success when another attempt already succeeded leaves the review open', () => {
    expect(
      decideOutcome(
        review('AMBIGUOUS_PROVIDER_STATUS', {
          paymentStatus: 'SUCCEEDED',
          others: ['SUCCEEDED'],
        }),
        success(),
      ),
    ).toEqual({ kind: 'no-change', reason: 'still-in-review' });
  });

  it.each(['LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS'] as const)(
    'a %s review is never resolved by a result',
    (reason) => {
      for (const outcome of [success(), failure]) {
        expect(decideOutcome(review(reason), outcome)).toEqual({
          kind: 'no-change',
          reason: 'not-handled',
        });
      }
    },
  );
});

describe('decideOutcome: results this rule leaves to later tickets', () => {
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
