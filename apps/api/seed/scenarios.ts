// The seed's data set: about 22 Payments that cover every case the Operator
// Console can display (ticket 01, spec "Seed contents"). Pure data, no
// database access: times are offsets from the moment the seed runs.

export type GatewayId = 'stripe' | 'fake';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'CANCELLED' | 'EXPIRED';
export type AttemptStatus =
  | 'CREATED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REQUIRES_REVIEW';
export type ReviewReason =
  | 'AMBIGUOUS_PROVIDER_STATUS'
  | 'AMOUNT_MISMATCH'
  | 'LATE_SUCCESS_ON_CLOSED_PAYMENT'
  | 'DUPLICATE_SUCCESS';

/** Either minutes after the Payment was created, or hours before the seed ran. */
export type When = { afterMin: number } | { agoH: number };

export interface TransitionSpec {
  from: string | null;
  to: string;
  trigger: string;
  actor: string;
  reason?: string;
  when: When;
}

export interface AttemptSpec {
  /** Stable name; the Attempt Key is derived from it. */
  key: string;
  gateway: GatewayId;
  status: AttemptStatus;
  /** Minutes after the Payment was created. Defaults to 1. */
  createdAfterMin?: number;
  nextAction?: Record<string, unknown>;
  review?: {
    reason: ReviewReason;
    openedAgoH: number;
    refundRequired: boolean;
    providerReportedAmount?: string;
  };
  transitions: TransitionSpec[];
}

export interface PaymentSpec {
  key: string;
  amount: string;
  createdAgoH: number;
  status: PaymentStatus;
  attempts: AttemptSpec[];
  /** Status changes after creation; `create_payment` is added automatically. */
  transitions: TransitionSpec[];
}

export interface CallbackSpec {
  key: string;
  gateway: GatewayId;
  status: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  /** Name of the attempt it concerns; `null` names an Attempt Key no attempt has. */
  attempt: string | null;
  providerEventId: string | null;
  receivedAgoH: number;
  attempts: number;
  lastError?: string;
}

export interface EventSpec {
  key: string;
  type:
    | 'PaymentCreated'
    | 'PaymentSucceeded'
    | 'PaymentCancelled'
    | 'PaymentExpired'
    | 'PaymentRequiresReview';
  payment: string;
  when: When;
  published: boolean;
}

const OPERATOR = 'operator.seed@example.com';

const tr = (
  from: string | null,
  to: string,
  trigger: string,
  actor: string,
  when: When,
  reason?: string,
): TransitionSpec => ({ from, to, trigger, actor, when, reason });

const started = (afterMin = 1) =>
  tr(null, 'CREATED', 'start_attempt', 'customer', { afterMin });
const accepted = (afterMin = 2) =>
  tr('CREATED', 'PENDING', 'gateway_accepted', 'system', { afterMin });
const paid = (afterMin: number, trigger = 'webhook') =>
  tr('PENDING', 'SUCCEEDED', trigger, 'system', { afterMin });
const paymentPaid = (afterMin: number, trigger = 'webhook') =>
  tr('PENDING', 'SUCCEEDED', trigger, 'system', { afterMin }, 'attempt succeeded');

function succeededOn(
  key: string,
  gateway: GatewayId,
  createdAgoH: number,
  amount: string,
): PaymentSpec {
  return {
    key,
    amount,
    createdAgoH,
    status: 'SUCCEEDED',
    attempts: [
      {
        key: 'a1',
        gateway,
        status: 'SUCCEEDED',
        transitions: [started(), accepted(), paid(15)],
      },
    ],
    transitions: [paymentPaid(15)],
  };
}

export function paymentSpecs(): PaymentSpec[] {
  return [
    // --- Pending Payments: no attempt, CREATED, and PENDING per NextAction type
    {
      key: 'P01',
      amount: '150000',
      createdAgoH: 1,
      status: 'PENDING',
      attempts: [],
      transitions: [],
    },
    {
      key: 'P02',
      amount: '230000',
      createdAgoH: 2,
      status: 'PENDING',
      attempts: [
        { key: 'a1', gateway: 'stripe', status: 'CREATED', transitions: [started()] },
      ],
      transitions: [],
    },
    {
      key: 'P03',
      amount: '320000',
      createdAgoH: 3,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'PENDING',
          nextAction: {
            type: 'CLIENT_SDK',
            token: 'pi_SEED_P03_secret_seed',
            clientParams: { publishableKey: 'pk_test_seed' },
          },
          transitions: [started(), accepted()],
        },
      ],
      transitions: [],
    },
    {
      key: 'P04',
      amount: '410000',
      createdAgoH: 5,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'fake',
          status: 'PENDING',
          nextAction: { type: 'REDIRECT', url: 'https://fake.example.com/pay/SEED-P04' },
          transitions: [started(), accepted()],
        },
      ],
      transitions: [],
    },
    {
      key: 'P05',
      amount: '500000',
      createdAgoH: 10,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'fake',
          status: 'PENDING',
          nextAction: { type: 'QR_CODE', payload: '00020101021238SEEDP05' },
          transitions: [started(), accepted()],
        },
      ],
      transitions: [],
    },
    {
      key: 'P06',
      amount: '620000',
      createdAgoH: 20,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'fake',
          status: 'PENDING',
          nextAction: { type: 'VOUCHER', details: { code: 'SEEDP06', bank: 'Seed Bank' } },
          transitions: [started(), accepted()],
        },
      ],
      transitions: [],
    },
    // --- Succeeded, and one that switched gateway
    succeededOn('P07', 'stripe', 30, '700000'),
    {
      key: 'P08',
      amount: '810000',
      createdAgoH: 48,
      status: 'SUCCEEDED',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'CANCELLED',
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'CANCELLED', 'gateway_switch', 'customer', { afterMin: 10 }, 'customer chose another gateway'),
          ],
        },
        {
          key: 'a2',
          gateway: 'fake',
          status: 'SUCCEEDED',
          createdAfterMin: 10,
          transitions: [started(10), accepted(11), paid(25, 'status_query')],
        },
      ],
      transitions: [paymentPaid(25, 'status_query')],
    },
    // --- Cancelled, expired, and a rejected attempt with the Payment still pending
    {
      key: 'P09',
      amount: '900000',
      createdAgoH: 72,
      status: 'CANCELLED',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'CANCELLED',
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'CANCELLED', 'merchant_cancel', 'merchant', { afterMin: 30 }),
          ],
        },
      ],
      transitions: [tr('PENDING', 'CANCELLED', 'merchant_cancel', 'merchant', { afterMin: 30 })],
    },
    {
      key: 'P10',
      amount: '1010000',
      createdAgoH: 120,
      status: 'EXPIRED',
      attempts: [
        {
          key: 'a1',
          gateway: 'fake',
          status: 'EXPIRED',
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'EXPIRED', 'expiry', 'system', { afterMin: 1440 }),
          ],
        },
      ],
      transitions: [tr('PENDING', 'EXPIRED', 'expiry', 'system', { afterMin: 1440 })],
    },
    {
      key: 'P11',
      amount: '1100000',
      createdAgoH: 6,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'FAILED',
          transitions: [
            started(),
            tr('CREATED', 'FAILED', 'gateway_rejected', 'system', { afterMin: 2 }, 'card_declined'),
          ],
        },
      ],
      transitions: [],
    },
    // --- Open Reviews
    {
      key: 'P12',
      amount: '1200000',
      createdAgoH: 144,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'REQUIRES_REVIEW',
          review: { reason: 'AMBIGUOUS_PROVIDER_STATUS', openedAgoH: 100, refundRequired: true },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'REQUIRES_REVIEW', 'status_query', 'system', { agoH: 100 }, 'AMBIGUOUS_PROVIDER_STATUS'),
          ],
        },
      ],
      transitions: [],
    },
    {
      key: 'P13',
      amount: '1300000',
      createdAgoH: 30,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'fake',
          status: 'REQUIRES_REVIEW',
          review: { reason: 'AMBIGUOUS_PROVIDER_STATUS', openedAgoH: 10, refundRequired: true },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'REQUIRES_REVIEW', 'status_query', 'system', { agoH: 10 }, 'AMBIGUOUS_PROVIDER_STATUS'),
          ],
        },
      ],
      transitions: [],
    },
    {
      key: 'P14',
      amount: '1000000',
      createdAgoH: 96,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'REQUIRES_REVIEW',
          review: {
            reason: 'AMOUNT_MISMATCH',
            openedAgoH: 80,
            refundRequired: true,
            providerReportedAmount: '1250000',
          },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'REQUIRES_REVIEW', 'webhook', 'system', { agoH: 80 }, 'AMOUNT_MISMATCH'),
          ],
        },
      ],
      transitions: [],
    },
    {
      key: 'P15',
      amount: '1500000',
      createdAgoH: 288,
      status: 'EXPIRED',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'REQUIRES_REVIEW',
          review: { reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT', openedAgoH: 250, refundRequired: true },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'EXPIRED', 'expiry', 'system', { afterMin: 1440 }),
            tr('EXPIRED', 'REQUIRES_REVIEW', 'webhook', 'system', { agoH: 250 }, 'LATE_SUCCESS_ON_CLOSED_PAYMENT'),
            tr('REQUIRES_REVIEW', 'REQUIRES_REVIEW', 'operator_note', OPERATOR, { agoH: 200 }, 'Refund requested from the Stripe dashboard'),
          ],
        },
      ],
      transitions: [tr('PENDING', 'EXPIRED', 'expiry', 'system', { afterMin: 1440 })],
    },
    {
      key: 'P16',
      amount: '1600000',
      createdAgoH: 192,
      status: 'SUCCEEDED',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'SUCCEEDED',
          transitions: [started(), accepted(), paid(15)],
        },
        {
          key: 'a2',
          gateway: 'fake',
          status: 'REQUIRES_REVIEW',
          createdAfterMin: 5,
          review: { reason: 'DUPLICATE_SUCCESS', openedAgoH: 150, refundRequired: true },
          transitions: [
            started(5),
            accepted(6),
            tr('PENDING', 'REQUIRES_REVIEW', 'webhook', 'system', { agoH: 150 }, 'DUPLICATE_SUCCESS'),
          ],
        },
      ],
      transitions: [paymentPaid(15)],
    },
    // --- Closed Reviews
    {
      key: 'P17',
      amount: '1700000',
      createdAgoH: 240,
      status: 'SUCCEEDED',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'SUCCEEDED',
          review: { reason: 'AMBIGUOUS_PROVIDER_STATUS', openedAgoH: 200, refundRequired: false },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'REQUIRES_REVIEW', 'status_query', 'system', { agoH: 200 }, 'AMBIGUOUS_PROVIDER_STATUS'),
            tr('REQUIRES_REVIEW', 'SUCCEEDED', 'operator_resolution', OPERATOR, { agoH: 150 }),
          ],
        },
      ],
      transitions: [
        tr('PENDING', 'SUCCEEDED', 'operator_resolution', OPERATOR, { agoH: 150 }, 'attempt succeeded'),
      ],
    },
    {
      key: 'P18',
      amount: '1800000',
      createdAgoH: 360,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'fake',
          status: 'FAILED',
          review: { reason: 'AMBIGUOUS_PROVIDER_STATUS', openedAgoH: 300, refundRequired: false },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'REQUIRES_REVIEW', 'status_query', 'system', { agoH: 300 }, 'AMBIGUOUS_PROVIDER_STATUS'),
            tr('REQUIRES_REVIEW', 'FAILED', 'operator_resolution', OPERATOR, { agoH: 200 }),
          ],
        },
      ],
      transitions: [],
    },
    {
      key: 'P19',
      amount: '1900000',
      createdAgoH: 432,
      status: 'PENDING',
      attempts: [
        {
          key: 'a1',
          gateway: 'stripe',
          status: 'FAILED',
          review: { reason: 'AMBIGUOUS_PROVIDER_STATUS', openedAgoH: 400, refundRequired: false },
          transitions: [
            started(),
            accepted(),
            tr('PENDING', 'REQUIRES_REVIEW', 'status_query', 'system', { agoH: 400 }, 'AMBIGUOUS_PROVIDER_STATUS'),
            tr(
              'REQUIRES_REVIEW',
              'FAILED',
              'operator_resolution',
              OPERATOR,
              { agoH: 300 },
              'Confirmed in the provider dashboard: the customer never completed payment',
            ),
          ],
        },
      ],
      transitions: [],
    },
    // --- Older Payments so the 30-day range has data
    succeededOn('P20', 'stripe', 240 + 1, '2000000'),
    succeededOn('P21', 'fake', 480, '2100000'),
    succeededOn('P22', 'stripe', 672, '2200000'),
  ];
}

export function callbackSpecs(): CallbackSpec[] {
  return [
    { key: 'C1', gateway: 'stripe', status: 'PROCESSED', attempt: 'P07/a1', providerEventId: 'SEED-evt-1', receivedAgoH: 29.75, attempts: 1 },
    { key: 'C2', gateway: 'stripe', status: 'RECEIVED', attempt: 'P03/a1', providerEventId: 'SEED-evt-2', receivedAgoH: 0.5, attempts: 0 },
    { key: 'C3', gateway: 'fake', status: 'PROCESSING', attempt: 'P04/a1', providerEventId: 'SEED-evt-3', receivedAgoH: 0.1, attempts: 1 },
    {
      key: 'C4',
      gateway: 'stripe',
      status: 'FAILED',
      attempt: 'P14/a1',
      providerEventId: 'SEED-evt-4',
      receivedAgoH: 80,
      attempts: 3,
      lastError: 'Payment lock timeout after 3 attempts',
    },
    { key: 'C5', gateway: 'fake', status: 'PROCESSED', attempt: 'P08/a2', providerEventId: null, receivedAgoH: 47.5, attempts: 1 },
    { key: 'C6', gateway: 'stripe', status: 'PROCESSED', attempt: null, providerEventId: 'SEED-evt-6', receivedAgoH: 12, attempts: 1 },
  ];
}

export function eventSpecs(): EventSpec[] {
  return [
    { key: 'E1', type: 'PaymentCreated', payment: 'P01', when: { afterMin: 0 }, published: false },
    { key: 'E2', type: 'PaymentCreated', payment: 'P07', when: { afterMin: 0 }, published: true },
    { key: 'E3', type: 'PaymentSucceeded', payment: 'P07', when: { afterMin: 15 }, published: true },
    { key: 'E4', type: 'PaymentCancelled', payment: 'P09', when: { afterMin: 30 }, published: true },
    { key: 'E5', type: 'PaymentExpired', payment: 'P10', when: { afterMin: 1440 }, published: false },
    { key: 'E6', type: 'PaymentRequiresReview', payment: 'P12', when: {agoH: 100}, published: true },
  ];
}
