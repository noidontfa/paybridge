/**
 * The in-memory fixture store behind every MSW handler. It holds the API's
 * records (flat, like the database) and assembles the API's response shapes
 * from them.
 *
 * Extension point: later tickets add a collection (Callbacks, ...) as another
 * array plus an accessor here, seed it in `./seed.ts`, and serve it from
 * `./handlers.ts`. Mutating handlers push to / edit these arrays directly.
 */
import type { CallbackStatus } from '@/features/callbacks/api';
import { ROLE_LABELS, type ManagedRole } from '@/features/auth/utils/roles';
import type { MockUser } from './users';
import type { OrganizationSummary } from '@/features/platform/api/organizations';
import type {
  AttemptStatus,
  NextAction,
  OperatorPayment,
  PaymentEvent,
  PaymentStatus,
  ReviewReason,
  StatusTransition,
  CheckoutOrigin,
} from '@/features/payments/schemas';

export interface MockPayment {
  id: string;
  upstreamReference: string;
  amount: string;
  currency: 'VND';
  status: PaymentStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  /** Set on Payments the Embedded Checkout created. */
  checkoutOrigin?: CheckoutOrigin | null;
}

export interface MockAttempt {
  id: string;
  paymentId: string;
  gatewayId: string;
  status: AttemptStatus;
  providerRef: string | null;
  nextAction?: NextAction;
  reviewReason?: ReviewReason;
  reviewOpenedAt?: string;
  refundRequired: boolean;
  /** What the provider reported, when the Review is about an amount (AMOUNT_MISMATCH). */
  providerReportedAmount?: string;
  createdAt: string;
  updatedAt: string;
}

/** A row of the webhook inbox (a Callback), body and all. */
export interface MockCallback {
  id: string;
  gatewayId: string;
  providerEventId: string | null;
  attemptKey: string | null;
  status: CallbackStatus;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  headers: Record<string, string>;
  query: Record<string, string>;
  rawBody: string;
  lastError: string | null;
}

/** What the API reports about a PaymentGateway. Never holds a credential. */
export interface MockGateway {
  id: string;
  registered: boolean;
  configured: boolean;
  mode: 'test' | 'live';
  callbackUrl: string;
}

const mockUser = (id: string, name: string, role: ManagedRole, active = true): MockUser => ({
  id,
  email: `${id}@example.test`,
  name,
  role,
  roleLabel: ROLE_LABELS[role],
  active,
  createdAt: '2026-01-05T09:00:00.000Z',
});

export class MockStore {
  /** The Organization's API Keys (the mock has one Organization). */
  readonly apiKeys: import('@/features/api-keys/api').ApiKey[] = [];

  /** The Organization's Pricing Plans. */
  readonly pricingPlans: import('@/lib/api/pricing-plans').PricingPlan[] = [];

  /** The Organization's Pricing Tables. */
  readonly pricingTables: import('@/lib/api/pricing-tables').PricingTable[] = [];

  /** The Organization's Publishable Keys. */
  readonly publishableKeys: import('@/lib/api/publishable-keys').PublishableKey[] = [];

  /** Pending Invitations, for the Invitations page. */
  readonly invitations: import('@/features/users/api/invitations').InvitationItem[] = [];

  /** The Organization's Gateway Connections (none until it connects one). */
  readonly gatewayConnections: import('@/features/gateway-connections/api').GatewayConnection[] = [];

  /** The Organization's Webhook Endpoints. */
  readonly webhookEndpoints: import('@/lib/api/webhook-endpoints').WebhookEndpoint[] = [];

  /** Deliveries to the Organization's Webhook Endpoints, each with its attempts. */
  readonly webhookDeliveries: import('@/lib/api/webhook-deliveries').WebhookDeliveryDetail[] = [];

  /** The Organization's Users, for the Users page. */
  readonly users: MockUser[] = [
    mockUser('dana', 'Dana Admin', 'ORGANIZATION_ADMIN'),
    mockUser('olu', 'Olu Operator', 'OPERATOR'),
    mockUser('pat', 'Pat Former', 'OPERATOR', false),
  ];

  /** Every Organization, for the Platform area. */
  readonly organizations: OrganizationSummary[] = [
    { id: 'org-default', name: 'Default Organization', status: 'ACTIVE', createdAt: '2026-01-01T09:00:00.000Z' },
    { id: 'org-acme', name: 'Acme Retail', status: 'ACTIVE', createdAt: '2026-02-01T09:00:00.000Z' },
    { id: 'org-dormant', name: 'Dormant Goods', status: 'SUSPENDED', createdAt: '2026-03-01T09:00:00.000Z' },
  ];

  /** The platform team, for the Platform area. */
  readonly superAdmins: MockUser[] = [
    { ...mockUser('sam', 'Sam Super Admin', 'OPERATOR'), role: 'SUPER_ADMIN', roleLabel: 'Super Admin' },
    { ...mockUser('sue', 'Sue Super Admin', 'OPERATOR'), role: 'SUPER_ADMIN', roleLabel: 'Super Admin' },
  ];

  /** Only `stripe` and `fake` exist. Tests replace the contents to model other states. */
  readonly gateways: MockGateway[] = [
    { id: 'stripe', registered: true, configured: true, mode: 'test', callbackUrl: 'https://pay.example.test/webhooks/stripe' },
    { id: 'fake', registered: true, configured: true, mode: 'test', callbackUrl: 'https://pay.example.test/webhooks/fake' },
  ];

  /**
   * The time the mocked API treats as "now" when a request changes something
   * (the 72-hour rule, transition times). `now` stays the seed's fixed clock;
   * the real clock is the default because the Console compares against the
   * browser clock. Tests replace it.
   */
  clock: () => Date = () => new Date();

  constructor(
    readonly now: Date,
    readonly payments: MockPayment[] = [],
    readonly attempts: MockAttempt[] = [],
    readonly transitions: StatusTransition[] = [],
    readonly events: PaymentEvent[] = [],
    readonly callbacks: MockCallback[] = [],
  ) {}

  getCallback(id: string): MockCallback | undefined {
    return this.callbacks.find((c) => c.id === id);
  }

  getPayment(id: string): MockPayment | undefined {
    return this.payments.find((p) => p.id === id);
  }

  /** Oldest first. */
  attemptsOf(paymentId: string): MockAttempt[] {
    return this.attempts.filter((a) => a.paymentId === paymentId).sort(byCreatedAt);
  }

  /** The status trail of a Payment or an attempt, oldest first. */
  transitionsOf(entityId: string): StatusTransition[] {
    return this.transitions.filter((t) => t.entityId === entityId).sort(byCreatedAt);
  }

  /** Oldest first. */
  eventsOf(paymentId: string): PaymentEvent[] {
    return this.events.filter((e) => e.paymentId === paymentId).sort(byCreatedAt);
  }

  /** The operator Payment detail response (`GET /internal/payments/:id`). */
  getOperatorPayment(id: string): OperatorPayment | undefined {
    const payment = this.getPayment(id);
    if (!payment) return undefined;
    return {
      ...payment,
      checkoutOrigin: payment.checkoutOrigin ?? null,
      attempts: this.attemptsOf(id).map(({ paymentId: _paymentId, ...attempt }) => ({
        ...attempt,
        transitions: this.transitionsOf(attempt.id),
      })),
      events: this.eventsOf(id),
    };
  }
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
