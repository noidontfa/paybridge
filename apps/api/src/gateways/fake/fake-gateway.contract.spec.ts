import {
  describeGatewayContract,
  failingContractChecks,
  type ContractOutcome,
  type GatewayContractRegistration,
} from '../../../test/contract/payment-gateway.contract.js';
import {
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  OutcomeUnknownError,
  type CallbackInput,
  type CallbackResult,
  type NormalizedStatus,
  type QueryInput,
  type QueryResult,
} from '../../payment-core/port/index.js';
import { FakeGatewayPlugin } from './fake-gateway.plugin.js';

/**
 * How the fake plugin is driven through each provider situation the contract
 * suite asks for. A real plugin's registration does the same with recorded
 * provider responses.
 */
function fakeRegistration<P extends FakeGatewayPlugin>(
  name: string,
  create: () => P,
): GatewayContractRegistration<P> {
  const outcome = (
    situation: string,
    status: NormalizedStatus,
  ): ContractOutcome<P> => ({
    situation,
    expected: status,
    arrangeQuery: (plugin, { attemptKey, amount }) => {
      plugin.scriptQuery({ status, amount, rawPayload: { attemptKey } });
    },
    callback: (plugin, { attemptKey, amount }) =>
      plugin.signedCallback({ attemptKey, status, amount }),
  });

  return {
    name,
    create,
    outcomes: [
      outcome('the customer has not paid yet', 'PENDING'),
      outcome('the provider confirms payment', 'SUCCEEDED'),
      outcome('the provider declines the payment', 'FAILED'),
      outcome('the provider flags the payment for review', 'REQUIRES_REVIEW'),
    ],
    errors: [
      {
        situation: 'the provider rejects the request',
        operation: 'initiate',
        category: 'GatewayRejected',
        arrange: (plugin) => {
          plugin.scriptInitiate(new GatewayRejectedError('declined'));
        },
      },
      {
        situation: 'the provider answers 503 before accepting',
        operation: 'initiate',
        category: 'GatewayUnavailable',
        arrange: (plugin) => {
          plugin.scriptInitiate(new GatewayUnavailableError('503'));
        },
      },
      {
        situation: 'the provider times out after the request was sent',
        operation: 'initiate',
        category: 'OutcomeUnknown',
        arrange: (plugin) => {
          plugin.scriptInitiate(new OutcomeUnknownError('timeout'));
        },
      },
      {
        situation: 'the provider has no such transaction',
        operation: 'query',
        category: 'NotFound',
        arrange: (plugin) => {
          plugin.scriptQuery(new GatewayNotFoundError('no such txn'));
        },
      },
    ],
    ignoredCallbacks: [
      {
        situation: 'an event type the plugin does not handle',
        build: (plugin) =>
          plugin.signedCallback({
            ignored: true,
            eventType: 'customer.created',
          }),
      },
    ],
    invalidCallbacks: [
      {
        problem: 'signed with another secret',
        build: (_plugin, { attemptKey }) =>
          new FakeGatewayPlugin({ secret: 'other' }).signedCallback({
            attemptKey,
            status: 'SUCCEEDED',
            amount: '150000',
          }),
      },
      {
        problem: 'no signature header',
        build: (plugin, { attemptKey }) => ({
          ...plugin.signedCallback({
            attemptKey,
            status: 'SUCCEEDED',
            amount: '150000',
          }),
          headers: { 'content-type': 'application/json' },
        }),
      },
    ],
  };
}

describeGatewayContract(
  fakeRegistration('fake plugin', () => new FakeGatewayPlugin()),
);

describeGatewayContract(
  fakeRegistration(
    'fake plugin without cancel',
    () => new FakeGatewayPlugin({ gatewayId: 'fake-b', supportsCancel: false }),
  ),
);

/**
 * Deliberately broken: maps the provider's "transaction expired" status to
 * `EXPIRED`, a state only Core may decide. Otherwise behaves like the fake.
 */
class ExpiringFakeGatewayPlugin extends FakeGatewayPlugin {
  private readonly expiredAtProvider = new Set<string>();

  /** The provider lets the transaction lapse. */
  expireAtProvider(attemptKey: string): void {
    this.expiredAtProvider.add(attemptKey);
  }

  override async query(input: QueryInput): Promise<QueryResult> {
    const result = await super.query(input);
    return this.expiredAtProvider.has(input.attemptKey)
      ? { ...result, status: 'EXPIRED' as NormalizedStatus }
      : result;
  }

  override async parseCallback(input: CallbackInput): Promise<CallbackResult> {
    const result = await super.parseCallback(input);
    if (result.ignored) return result;
    return this.expiredAtProvider.has(result.attemptKey)
      ? { ...result, status: 'EXPIRED' as NormalizedStatus }
      : result;
  }
}

/** Deliberately broken: says it cannot cancel, yet exposes `cancel`. */
class MisdeclaredCancelFakeGatewayPlugin extends FakeGatewayPlugin {
  override readonly capabilities = { supportsCancel: false };
}

describe('the contract suite rejects broken plugins', () => {
  it('fails a plugin that reports EXPIRED', async () => {
    const registration = fakeRegistration(
      'expiring fake',
      () => new ExpiringFakeGatewayPlugin(),
    );
    registration.outcomes.push({
      situation: 'the provider reports the transaction expired',
      expected: 'FAILED',
      arrangeQuery: (plugin, { attemptKey }) => {
        plugin.expireAtProvider(attemptKey);
      },
      callback: (plugin, { attemptKey }) => {
        plugin.expireAtProvider(attemptKey);
        return plugin.signedCallback({
          attemptKey,
          status: 'FAILED',
          amount: null,
        });
      },
    });

    const failures = await failingContractChecks(registration);

    expect(failures.map((f) => f.name)).toEqual([
      'query: the provider reports the transaction expired -> FAILED',
      'callback: the provider reports the transaction expired -> FAILED with the success acknowledgement',
    ]);
    for (const failure of failures) {
      expect(failure.error).toContain('plugin reported EXPIRED');
    }
  });

  it('fails a plugin whose capability flags do not match its operations', async () => {
    const failures = await failingContractChecks(
      fakeRegistration(
        'misdeclared fake',
        () => new MisdeclaredCancelFakeGatewayPlugin(),
      ),
    );

    expect(failures.map((f) => f.name)).toEqual([
      expect.stringContaining('capability'),
    ]);
  });

  it('fails a registration that leaves an error category uncovered', async () => {
    const registration = fakeRegistration(
      'thin fake',
      () => new FakeGatewayPlugin(),
    );
    registration.errors = registration.errors.filter(
      (e) => e.category !== 'OutcomeUnknown',
    );

    const failures = await failingContractChecks(registration);

    expect(failures.map((f) => f.error)).toContainEqual(
      expect.stringContaining('OutcomeUnknown'),
    );
  });

  it('fails an ignored callback that the plugin handles instead', async () => {
    const registration = fakeRegistration(
      'bad ignored fake',
      () => new FakeGatewayPlugin(),
    );
    registration.ignoredCallbacks = [
      {
        situation: 'a handled callback registered as ignored',
        build: (plugin, { attemptKey }) =>
          plugin.signedCallback({
            attemptKey,
            status: 'SUCCEEDED',
            amount: '150000',
          }),
      },
    ];

    const failures = await failingContractChecks(registration);

    expect(failures.map((f) => f.name)).toEqual([
      'callback: a handled callback registered as ignored -> ignored with a 2xx acknowledgement',
    ]);
  });
});
