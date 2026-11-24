import { describe, expect, it } from 'vitest';
import {
  InvalidCallbackError,
  NORMALIZED_STATUSES,
  isGatewayError,
  type CallbackAck,
  type CallbackInput,
  type GatewayErrorCategory,
  type InitiateInput,
  type InitiateResult,
  type NormalizedStatus,
  type PaymentGateway,
} from '../../src/payment-core/port/index.js';

/**
 * The shared contract suite every Gateway Plugin must pass. A plugin needs no
 * bespoke tests of its own: it supplies a registration that tells the suite
 * how to put the provider (a recorded response, a stub server, or a scripted
 * fake) into each situation, and the suite checks what the plugin reports
 * through the port.
 */

/** Values the suite uses for one attempt. */
export interface ContractContext {
  readonly attemptKey: string;
  /** Decimal string in the currency's major unit, as Core passes to `initiate`. */
  readonly amount: string;
}

type Arrange<P, R = void> = (plugin: P, ctx: ContractContext) => R | Promise<R>;

/** A provider situation and the normalised state the plugin must report for it. */
export interface ContractOutcome<P> {
  readonly situation: string;
  readonly expected: NormalizedStatus;
  /** Makes the provider answer the next `query` with this situation. */
  readonly arrangeQuery: Arrange<P>;
  /** An authentic provider callback that reports this situation. */
  readonly callback: Arrange<P, CallbackInput>;
}

/** Error categories reported by `initiate`, `query` or `cancel`. */
export type OperationErrorCategory = Exclude<
  GatewayErrorCategory,
  'InvalidCallback'
>;

/** A provider failure and the error category the plugin must throw for it. */
export interface ContractError<P> {
  readonly situation: string;
  readonly operation: 'initiate' | 'query' | 'cancel';
  readonly category: OperationErrorCategory;
  /** Makes the provider fail the next call to `operation` this way. */
  readonly arrange: Arrange<P>;
}

/** A callback the plugin must reject as `InvalidCallback`. */
export interface ContractInvalidCallback<P> {
  readonly problem: string;
  readonly build: Arrange<P, CallbackInput>;
}

/** A verified callback the plugin must ignore: acknowledged, never applied. */
export interface ContractIgnoredCallback<P> {
  readonly situation: string;
  readonly build: Arrange<P, CallbackInput>;
}

export interface GatewayContractRegistration<
  P extends PaymentGateway = PaymentGateway,
> {
  /** Shown in test names. */
  readonly name: string;
  /** Builds a fresh plugin (and its provider stub). Called once per check. */
  readonly create: () => P | Promise<P>;
  /** Must cover every normalised state. */
  outcomes: ContractOutcome<P>[];
  /** Must cover every operation error category. */
  errors: ContractError<P>[];
  /** Authentic callbacks that are irrelevant to PayBridge. Optional. */
  ignoredCallbacks?: ContractIgnoredCallback<P>[];
  /** Provider-specific invalid callbacks, on top of the suite's tampered body. */
  invalidCallbacks: ContractInvalidCallback<P>[];
}

export interface ContractCheck {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** The retryable flag of each category, as fixed by the spec. */
const RETRYABLE: Readonly<Record<GatewayErrorCategory, boolean>> = {
  GatewayRejected: false,
  GatewayUnavailable: true,
  OutcomeUnknown: false,
  InvalidCallback: false,
  NotFound: false,
};

const OPERATION_ERROR_CATEGORIES: readonly OperationErrorCategory[] = [
  'GatewayRejected',
  'GatewayUnavailable',
  'OutcomeUnknown',
  'NotFound',
];

const NEXT_ACTION_FIELD = {
  REDIRECT: 'url',
  QR_CODE: 'payload',
  CLIENT_SDK: 'token',
  VOUCHER: 'details',
} as const;

const DECIMAL = /^\d+(\.\d+)?$/;

const context: ContractContext = {
  attemptKey: '019ab5f0-6c1e-7a3b-9c2d-4e5f60718293',
  amount: '150000',
};

function initiateInput(ctx: ContractContext): InitiateInput {
  return {
    attemptKey: ctx.attemptKey,
    amount: ctx.amount,
    currency: 'VND',
    expiresAt: new Date('2026-11-24T10:30:00.000Z'),
    returnUrl: 'https://merchant.example/return',
    description: 'Contract suite order',
  };
}

/** Returns the checks for one plugin, so callers can run them or inspect failures. */
export function gatewayContractChecks<P extends PaymentGateway>(
  registration: GatewayContractRegistration<P>,
): ContractCheck[] {
  const checks: ContractCheck[] = [];
  const check = (name: string, run: (plugin: P) => Promise<void>) =>
    checks.push({
      name,
      run: async () => run(await registration.create()),
    });

  check('capability flags match the operations available', async (plugin) => {
    expect(plugin.gatewayId, 'gatewayId').toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(typeof plugin.capabilities.supportsCancel).toBe('boolean');
    expect(
      typeof plugin.cancel === 'function',
      `supportsCancel is ${plugin.capabilities.supportsCancel} but cancel is ${
        typeof plugin.cancel === 'function' ? 'present' : 'absent'
      }`,
    ).toBe(plugin.capabilities.supportsCancel);
  });

  check(
    'initiate returns a next action, JSON provider metadata and the raw response',
    async (plugin) => {
      expectInitiateResult(await plugin.initiate(initiateInput(context)));
    },
  );

  check('cancel, when supported, returns the raw response', async (plugin) => {
    if (!plugin.capabilities.supportsCancel || !plugin.cancel) return;
    const { providerMetadata } = await plugin.initiate(initiateInput(context));
    const result = await plugin.cancel({
      attemptKey: context.attemptKey,
      providerMetadata,
    });
    expect(result.rawPayload).toBeDefined();
  });

  check('outcomes cover every normalised state', async () => {
    const covered = new Set(registration.outcomes.map((o) => o.expected));
    const missing = NORMALIZED_STATUSES.filter((s) => !covered.has(s));
    expect(missing, `no outcome expects ${missing.join(', ')}`).toEqual([]);
  });

  for (const outcome of registration.outcomes) {
    check(
      `query: ${outcome.situation} -> ${outcome.expected}`,
      async (plugin) => {
        const { providerMetadata } = await plugin.initiate(
          initiateInput(context),
        );
        await outcome.arrangeQuery(plugin, context);
        const result = await plugin.query({
          attemptKey: context.attemptKey,
          providerMetadata,
        });
        expectNormalisedStatus(result.status, outcome.expected);
        expectAmount(result.amount);
        expect(result.rawPayload).toBeDefined();
      },
    );

    check(
      `callback: ${outcome.situation} -> ${outcome.expected} with the success acknowledgement`,
      async (plugin) => {
        const input = await outcome.callback(plugin, context);
        const result = await plugin.parseCallback(input);
        expect(result.ignored, 'callback was ignored, not handled').not.toBe(
          true,
        );
        if (result.ignored) return;
        expectNormalisedStatus(result.status, outcome.expected);
        expectAmount(result.amount);
        expect(result.attemptKey, 'attemptKey derived from provider data').toBe(
          context.attemptKey,
        );
        expectAck(result.ack);
        expect(
          result.ack.httpStatus,
          'success ack is a 2xx response',
        ).toBeGreaterThanOrEqual(200);
        expect(result.ack.httpStatus).toBeLessThan(300);
      },
    );
  }

  check('errors cover every error category', async () => {
    const covered = new Set(registration.errors.map((e) => e.category));
    const missing = OPERATION_ERROR_CATEGORIES.filter((c) => !covered.has(c));
    expect(missing, `no error scenario for ${missing.join(', ')}`).toEqual([]);
  });

  for (const scenario of registration.errors) {
    check(
      `${scenario.operation}: ${scenario.situation} -> ${scenario.category} (retryable=${RETRYABLE[scenario.category]})`,
      async (plugin) => {
        const error = await captureError(async () => {
          if (scenario.operation === 'initiate') {
            await scenario.arrange(plugin, context);
            await plugin.initiate(initiateInput(context));
            return;
          }
          const { providerMetadata } = await plugin.initiate(
            initiateInput(context),
          );
          await scenario.arrange(plugin, context);
          const input = { attemptKey: context.attemptKey, providerMetadata };
          if (scenario.operation === 'query') {
            await plugin.query(input);
          } else if (plugin.capabilities.supportsCancel && plugin.cancel) {
            await plugin.cancel(input);
          } else {
            throw new Error('cancel scenario on a plugin without cancel');
          }
        });
        expectGatewayError(error, scenario.category);
      },
    );
  }

  for (const ignored of registration.ignoredCallbacks ?? []) {
    check(
      `callback: ${ignored.situation} -> ignored with a 2xx acknowledgement`,
      async (plugin) => {
        const result = await plugin.parseCallback(
          await ignored.build(plugin, context),
        );
        expect(result.ignored, 'plugin ignored the callback').toBe(true);
        expectAck(result.ack);
        expect(
          result.ack.httpStatus,
          'ack is a 2xx response',
        ).toBeGreaterThanOrEqual(200);
        expect(result.ack.httpStatus).toBeLessThan(300);
      },
    );
  }

  check(
    'callback: a tampered body -> InvalidCallback with an error acknowledgement',
    async (plugin) => {
      const [first] = registration.outcomes;
      expect(first, 'at least one outcome is registered').toBeDefined();
      const authentic = await first.callback(plugin, context);
      const rawBody = Uint8Array.from(authentic.rawBody);
      rawBody[Math.floor(rawBody.length / 2)] ^= 0x01;
      await expectInvalidCallback(
        plugin.parseCallback({ ...authentic, rawBody }),
      );
    },
  );

  for (const invalid of registration.invalidCallbacks) {
    check(
      `callback: ${invalid.problem} -> InvalidCallback with an error acknowledgement`,
      async (plugin) => {
        const input = await invalid.build(plugin, context);
        await expectInvalidCallback(plugin.parseCallback(input));
      },
    );
  }

  return checks;
}

/** Registers the contract suite for one plugin with Vitest. */
export function describeGatewayContract<P extends PaymentGateway>(
  registration: GatewayContractRegistration<P>,
): void {
  describe(`PaymentGateway contract: ${registration.name}`, () => {
    for (const { name, run } of gatewayContractChecks(registration)) {
      it(name, run);
    }
  });
}

/** Runs every check and returns the ones that failed, with their messages. */
export async function failingContractChecks<P extends PaymentGateway>(
  registration: GatewayContractRegistration<P>,
): Promise<{ name: string; error: string }[]> {
  const failures: { name: string; error: string }[] = [];
  for (const { name, run } of gatewayContractChecks(registration)) {
    try {
      await run();
    } catch (error) {
      failures.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return failures;
}

function expectNormalisedStatus(
  status: string,
  expected: NormalizedStatus,
): void {
  expect(
    (NORMALIZED_STATUSES as readonly string[]).includes(status),
    `plugin reported ${status}, which is not a normalised state (${NORMALIZED_STATUSES.join(', ')})`,
  ).toBe(true);
  expect(status).toBe(expected);
}

function expectAmount(amount: string | null): void {
  if (amount === null) return;
  expect(amount, 'amount is a decimal string in the major unit').toMatch(
    DECIMAL,
  );
}

function expectInitiateResult(result: InitiateResult): void {
  const field = NEXT_ACTION_FIELD[result.nextAction?.type];
  expect(field, `unknown next action ${result.nextAction?.type}`).toBeDefined();
  expect(
    (result.nextAction as unknown as Record<string, unknown>)[field],
    `next action ${result.nextAction.type} has its ${field}`,
  ).toBeTruthy();
  expect(result.providerMetadata).toBeTypeOf('object');
  expect(
    JSON.parse(JSON.stringify(result.providerMetadata)),
    'provider metadata survives a JSON round trip (Core stores it as JSON)',
  ).toEqual(result.providerMetadata);
  expect(result.rawPayload).toBeDefined();
  if (result.providerRef !== undefined) {
    expect(result.providerRef).toBeTypeOf('string');
  }
}

function expectAck(ack: CallbackAck): void {
  expect(ack, 'acknowledgement').toBeDefined();
  expect(Number.isInteger(ack.httpStatus), 'ack httpStatus is an integer').toBe(
    true,
  );
  expect(ack.httpStatus).toBeGreaterThanOrEqual(100);
  expect(ack.httpStatus).toBeLessThan(600);
  expect(ack.body, 'ack body').toBeDefined();
  for (const value of Object.values(ack.headers ?? {})) {
    expect(value, 'ack header values are strings').toBeTypeOf('string');
  }
}

function expectGatewayError(
  error: unknown,
  category: GatewayErrorCategory,
): void {
  expect(
    isGatewayError(error),
    `expected a GatewayError, got ${String(error)}`,
  ).toBe(true);
  if (!isGatewayError(error)) return;
  expect(error.category).toBe(category);
  expect(error.retryable, `${category} retryable flag`).toBe(
    RETRYABLE[category],
  );
}

async function expectInvalidCallback(result: Promise<unknown>): Promise<void> {
  const error = await captureError(() => result);
  expectGatewayError(error, 'InvalidCallback');
  expect(error).toBeInstanceOf(InvalidCallbackError);
  expectAck((error as InvalidCallbackError).ack);
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the plugin to throw, but it returned normally');
}
